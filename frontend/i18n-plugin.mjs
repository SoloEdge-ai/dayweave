import { readFileSync } from 'node:fs'

const loadCatalog = name => JSON.parse(readFileSync(new URL('./src/locales/' + name + '.json', import.meta.url), 'utf8'))
const catalogs = ['zh-CN', 'en', 'ja'].map(loadCatalog)
const chinese = /[\u3400-\u9fff]/

// Extract only source literals. API values and user input never pass through this visitor.
export default function dayweaveMessages({ types: b }) {
  const alias = '__dayweaveTranslate'
  function lookup(key, state, path) {
    if (catalogs.some(catalog => !Object.hasOwn(catalog, key))) {
      throw path.buildCodeFrameError('Add this message to all DayWeave locale catalogs: ' + key)
    }
    state.usedMessages = true
    return b.callExpression(b.identifier(alias), [b.stringLiteral(key)])
  }
  return {
    name: 'dayweave-localized-source-messages',
    visitor: {
      Program: {
        enter(path, state) {
          const file = state.filename?.replaceAll('\\', '/') || ''
          if (!file.includes('/src/') || file.includes('/src/locales/') || file.endsWith('/i18n.ts')) path.skip()
        },
        exit(path, state) {
          if (state.usedMessages) {
            path.unshiftContainer('body', b.importDeclaration(
              [b.importSpecifier(b.identifier(alias), b.identifier('message'))],
              b.stringLiteral('/src/i18n.ts')
            ))
          }
        }
      },
      JSXText(path, state) {
        const key = path.node.value.trim().replace(/\s*\n\s*/g, ' ')
        if (!chinese.test(key)) return
        path.replaceWith(b.jsxExpressionContainer(lookup(key, state, path)))
        path.skip()
      },
      StringLiteral(path, state) {
        const key = path.node.value
        if (!chinese.test(key)) return
        const parent = path.parentPath
        if (parent.isObjectProperty() && path.key === 'key') return
        const call = lookup(key, state, path)
        if (parent.isJSXAttribute()) {
          path.replaceWith(b.jsxExpressionContainer(call))
        } else if (parent.isObjectProperty() && !path.getFunctionParent()) {
          // Enum label tables are module-level. Resolve their text in the active locale at read time.
          parent.replaceWith(b.objectMethod('get', parent.node.key, [], b.blockStatement([b.returnStatement(call)])))
          parent.skip()
        } else {
          path.replaceWith(call)
        }
        path.skip()
      }
    }
  }
}
