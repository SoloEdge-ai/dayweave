from datetime import date, timezone
import re
from typing import Annotated, Literal
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import (
    AfterValidator, AwareDatetime, BaseModel, ConfigDict, Field, HttpUrl, StringConstraints,
    field_validator, model_validator,
)
from .i18n import Language

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
ShortText = Annotated[str, StringConstraints(max_length=300)]
Description = Annotated[str, StringConstraints(max_length=30000)]
IdList = Annotated[list[Annotated[int, Field(gt=0)]], Field(max_length=500)]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_default=True)


TagName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
TagNames = Annotated[list[TagName], Field(max_length=100)]


class TagInput(Input):
    name: TagName


def normalized_link(value: str) -> str:
    link = HttpUrl(value.strip())
    if link.username or link.password:
        raise ValueError("resource.credentials_in_url")
    return str(link)


def validate_task_url(value: str) -> str:
    text = value.strip()
    if not text.lower().startswith(("http://", "https://")) or re.search(r"[\s\\]", text):
        raise ValueError("validation.url")
    return normalized_link(text)


TaskUrl = Annotated[str, Field(min_length=1, max_length=5000), AfterValidator(validate_task_url)]


class TaskLink(Input):
    url: TaskUrl
    title: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = None

    def resource_title(self) -> str:
        if self.title:
            return self.title
        parts = urlsplit(self.url)
        issue = re.search(r"/browse/([A-Z][A-Z0-9_]*-\d+)/?$", parts.path, re.IGNORECASE)
        if issue:
            return issue.group(1).upper()
        return (parts.netloc + parts.path.rstrip("/"))[:500]


TaskLinks = Annotated[list[TaskLink], Field(max_length=100)]


class ScheduleFields(Input):
    scheduled_date: date | None = None
    scheduled_period: Literal["morning", "afternoon", "evening"] | None = None
    planned_start_at: AwareDatetime | None = None
    planned_end_at: AwareDatetime | None = None
    planning_window: Literal["week", "month"] | None = None
    window_start: date | None = None
    allow_due_conflict: bool = False


class SchedulePatch(ScheduleFields):
    expected_updated_at: str = Field(min_length=1, max_length=64)


TaskStatus = Literal["todo", "in_progress", "done", "cancelled"]


ResumeText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=600)]


class ResumeNotePatch(Input):
    text: ResumeText
    expected_updated_at: str | None = Field(max_length=64)


class StatusMove(Input):
    expected_status: TaskStatus
    status: TaskStatus


class TaskInput(ScheduleFields):
    title: Title
    description: Description = ""
    status: TaskStatus = "todo"
    priority: Literal["low", "medium", "high"] = "medium"
    category: ShortText = ""
    tags: TagNames = Field(default_factory=list)
    project_id: int | None = Field(None, gt=0)
    estimated_minutes: int | None = Field(None, gt=0, le=525600)
    due_date: date | None = None
    due_period: Literal["morning", "afternoon", "evening"] | None = None
    due_at: AwareDatetime | None = None
    pinned: bool = False
    resource_ids: IdList = Field(default_factory=list)
    links: TaskLinks = Field(default_factory=list)
    primary_resource_id: int | None = Field(None, gt=0)
    primary_link_url: TaskUrl | None = None

    @field_validator("links")
    @classmethod
    def unique_links(cls, values):
        unique = {}
        for link in values:
            unique.setdefault(link.url, link)
        return list(unique.values())

    @field_validator("planned_start_at", "planned_end_at", "due_at")
    @classmethod
    def to_utc(cls, value):
        return value.astimezone(timezone.utc) if value else None

    @model_validator(mode="after")
    def validate_precision(self):
        if self.primary_resource_id is not None and self.primary_link_url is not None:
            raise ValueError("task.primary_conflict")
        if "tags" not in self.model_fields_set and self.category.strip():
            self.tags = [self.category.strip()]
        self.category = self.tags[0] if self.tags else ""
        if bool(self.planning_window) != bool(self.window_start):
            raise ValueError("time.window_pair")
        if self.planning_window:
            if any((self.scheduled_date, self.scheduled_period, self.planned_start_at, self.planned_end_at)):
                raise ValueError("time.window_exact")
            if ((self.planning_window == "week" and self.window_start.weekday() != 0)
                    or (self.planning_window == "month" and self.window_start.day != 1)):
                raise ValueError("time.window_anchor")
        if self.due_period and not self.due_date:
            raise ValueError("time.due_period_without_date")
        if self.due_date and self.due_at:
            raise ValueError("time.deadline_precision")
        if self.planned_end_at and (not self.planned_start_at or self.planned_end_at <= self.planned_start_at):
            raise ValueError("time.end_before_start")
        if self.scheduled_period and not self.scheduled_date:
            raise ValueError("time.period_without_date")
        return self


class ProjectInput(Input):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    description: Description = ""
    status: Literal["active", "paused", "completed", "archived"] = "active"
    target_date: date | None = None


class ResourceInput(Input):
    title: Title
    url: str | None = Field(None, max_length=5000)
    type: Literal["video", "web", "pdf", "markdown", "other"] = "web"
    source: ShortText = ""
    description: Description = ""
    reason: Description = ""
    notes: Description = ""
    duration_seconds: int | None = Field(None, gt=0, le=100000000)
    total_pages: int | None = Field(None, gt=0, le=10000000)
    position_unit: Literal["seconds", "pages", "percent"] | None = None
    current_position: int = Field(0, ge=0, le=100000000)
    progress_status: Literal["unstarted", "in_progress", "completed"] = "unstarted"
    project_ids: IdList = Field(default_factory=list)

    @field_validator("url")
    @classmethod
    def valid_link(cls, value):
        return normalized_link(value) if value else None

    @model_validator(mode="after")
    def check_progress(self):
        expected = {"video": "seconds", "pdf": "pages"}.get(self.type, "percent")
        if self.position_unit and self.position_unit != expected:
            raise ValueError("resource.progress_unit")
        self.position_unit = expected
        limit = {"seconds": self.duration_seconds, "pages": self.total_pages, "percent": 100}[expected]
        if limit is not None and self.current_position > limit:
            raise ValueError("resource.progress_range")
        if self.url and not self.source:
            self.source = urlsplit(self.url).hostname or ""
        return self


class SettingsInput(Input):
    language: Language = "zh-CN"
    timezone: ShortText = "Asia/Hong_Kong"
    theme: Literal["light", "dark", "system"] = "system"
    week_start: Literal[0] = 0
    default_provider: ShortText | None = None
    default_model: ShortText | None = None
    default_reasoning: ShortText = "auto"
    planning_preferences: Description = ""

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("settings.invalid_timezone")
        return value
