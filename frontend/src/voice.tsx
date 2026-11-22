import { useEffect, useRef, useState } from 'react'
import { AudioLines, FileAudio, LoaderCircle, Mic, Square, X } from 'lucide-react'
import { errorText, responseError } from './api'
import { ErrorBox, IconButton } from './ui'

const maxBytes = 20 * 1024 * 1024
const maxSeconds = 120
const stopAtSeconds = maxSeconds - 1
const audioFormats = 'audio/*,.wav,.mp3,.m4a,.mp4,.aac,.adts,.webm,.ogg,.opus,.flac'
function extension(mime:string) {
  if(mime.includes('mp4'))return 'm4a'
  if(mime.includes('ogg'))return 'ogg'
  return 'webm'
}
export function VoiceInput({insert,close}:{insert:(value:string)=>void;close:()=>void}) {
  const [file,setFile]=useState<File|null>(null),[url,setUrl]=useState('')
  const [phase,setPhase]=useState<'idle'|'asking'|'recording'|'transcribing'>('idle')
  const [elapsed,setElapsed]=useState(0),[error,setError]=useState('')
  const active=useRef(true),stream=useRef<MediaStream|null>(null),recorder=useRef<MediaRecorder|null>(null)
  const controller=useRef<AbortController|null>(null),timer=useRef<ReturnType<typeof setInterval>|undefined>()
  const mountedAudio=useRef<HTMLAudioElement>(null),chosenFile=useRef<HTMLInputElement>(null)
  const deviceFile=useRef<HTMLInputElement>(null)
  const canRecord=window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder!=='undefined'
  const locked=phase!=='idle'

  function stopTracks(){stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;clearInterval(timer.current)}
  useEffect(()=>{
    active.current=true
    return ()=>{
      active.current=false;controller.current?.abort()
      if(recorder.current?.state==='recording')recorder.current.stop()
      stopTracks()
    }
  },[])
  useEffect(()=>{
    if(!file){setUrl('');return}
    const src=URL.createObjectURL(file);setUrl(src)
    return ()=>URL.revokeObjectURL(src)
  },[file])
  function choose(audio:File|undefined){
    if(!audio)return
    setError('')
    if(audio.size===0 || audio.size>maxBytes){setError('请选择非空且不超过 20 MiB 的音频。');return}
    setFile(audio)
  }
  async function record(){
    if(locked||!canRecord)return
    setError('');setPhase('asking')
    try {
      const mic=await navigator.mediaDevices.getUserMedia({audio:true})
      if(!active.current){mic.getTracks().forEach(t=>t.stop());return}
      stream.current=mic
      const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(v=>MediaRecorder.isTypeSupported?.(v))
      const capture=new MediaRecorder(mic,mime?{mimeType:mime}:undefined)
      const chunks:Blob[]=[]
      recorder.current=capture
      capture.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)}
      capture.onstop=()=>{
        stopTracks();recorder.current=null
        if(!active.current)return
        setPhase('idle')
        const type=capture.mimeType||chunks[0]?.type||'audio/webm'
        choose(new File(chunks,'dayweave-recording.'+extension(type),{type}))
      }
      capture.onerror=()=>{stopTracks();if(active.current){setError('录音失败，请选择已有音频。');setPhase('idle')}}
      const started=Date.now()
      setElapsed(0);setFile(null);capture.start(1000);setPhase('recording')
      timer.current=setInterval(()=>{
        const seconds=Math.floor((Date.now()-started)/1000);setElapsed(seconds)
        if(seconds>=stopAtSeconds&&capture.state==='recording')capture.stop()
      },300)
    }catch(e){
      stopTracks()
      if(!active.current)return
      setPhase('idle');setError(e instanceof DOMException&&e.name==='NotAllowedError'?'未获得麦克风权限。可以选择已有音频。':'无法打开麦克风，请选择已有音频。')
    }
  }
  async function transcribe(){
    if(locked||!file)return
    const length=mountedAudio.current?.duration
    if(length&&Number.isFinite(length)&&length>maxSeconds){setError('音频超过两分钟，请剪短后再试。');return}
    setPhase('transcribing');setError('')
    const abort=new AbortController();controller.current=abort
    try{
      const data=new FormData()
      data.set('file',file);data.set('language',document.documentElement.lang)
      const response=await fetch('/api/ai/transcribe',{method:'POST',body:data,signal:abort.signal,credentials:'same-origin',headers:{'Accept-Language':document.documentElement.lang}})
      if(!response.ok)throw new Error(await responseError(response))
      const result=await response.json()
      if(typeof result.text!=='string'||!result.text.trim())throw new Error('未识别到语音，请重录或选择其他音频。')
      if(active.current)insert(result.text.trim())
    }catch(e){if(active.current&&!abort.signal.aborted)setError(errorText(e))}
    finally{controller.current=null;if(active.current)setPhase('idle')}
  }
  return <section className="voice-panel" aria-label="语音输入"><header><div><Mic size={17}/><strong>语音输入</strong></div><IconButton icon={X} label="关闭语音输入" onClick={close}/></header>
    <p>由当前服务器本地转写，识别结果可在发送前编辑。</p>
    {phase==='recording'?<button className="secondary recording" onClick={()=>recorder.current?.stop()}><Square size={14}/>停止录音 · {elapsed}s</button>:<div className="voice-sources">
      {canRecord?<button className="secondary" onClick={()=>void record()} disabled={locked}><Mic size={15}/>{phase==='asking'?'等待麦克风权限…':'开始录音'}</button>:<button className="secondary" onClick={()=>deviceFile.current?.click()} disabled={locked}><Mic size={15}/>使用设备录音</button>}
      <button className="secondary" onClick={()=>chosenFile.current?.click()} disabled={locked}><FileAudio size={15}/>选择音频</button>
    </div>}
    <input ref={chosenFile} type="file" hidden aria-label="选择音频文件" accept={audioFormats} onChange={e=>{choose(e.target.files?.[0]);e.target.value=''}}/>
    <input ref={deviceFile} type="file" hidden aria-label="使用设备录音" accept="audio/*" capture="user" onChange={e=>{choose(e.target.files?.[0]);e.target.value=''}}/>
    {!canRecord&&<p>当前浏览器不支持直接录音。可使用设备录音工具，或选择已有音频。</p>}
    {file&&<div className="voice-preview"><span>{file.name}</span>{url&&<audio controls src={url} ref={mountedAudio} preload="metadata"/>}<button className="primary" disabled={locked} onClick={()=>void transcribe()}>{phase==='transcribing'?<LoaderCircle size={15} className="spin"/>:<AudioLines size={15}/>} {phase==='transcribing'?'正在本地转写…':'转写到输入框'}</button></div>}
    <small>最长两分钟，最大 20 MiB。</small>
    {error&&<ErrorBox message={error}/>}
  </section>
}
