"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent,
  ClipboardEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from "react";

type TaskStatus = "active" | "later" | "done";

type Task = {
  id: string;
  title: string;
  note: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  returnAt: number | null;
  totalSeconds: number;
  startedAt: number | null;
};

type Workspace = {
  schemaVersion: 3;
  tasks: Task[];
  focusEndsAt: number | null;
  lastLandingAt: number | null;
};

type SwitchTarget =
  | { mode: "task"; id: string }
  | { mode: "new"; title?: string }
  | null;

type TaskFilter = "open" | "done";

type EditTarget = {
  id: string;
  focus: "title" | "note";
};

type EditDraft = {
  title: string;
  note: string;
  returnAt: number | null;
};

type DeletedTask = {
  task: Task;
  index: number;
  wasActive: boolean;
};

type ImportDraft = {
  workspace: Workspace;
  fileName: string;
};

const DB_NAME = "xuxian-local-v1";
const STORE_NAME = "workspace";
const WORKSPACE_KEY = "main";
const SCHEMA_VERSION = 3;

function uid(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function asText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

const NOTE_TAGS = new Set(["B", "BR", "DIV", "LI", "OL", "P", "STRONG", "U", "UL"]);

function sanitizeNoteHtml(value: string) {
  if (!value.trim()) return "";
  if (typeof document === "undefined") return value;

  const template = document.createElement("template");
  template.innerHTML = value;

  const clean = (parent: ParentNode) => {
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === Node.COMMENT_NODE) {
        node.remove();
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;

      const element = node as HTMLElement;
      if (["SCRIPT", "STYLE", "IFRAME", "OBJECT"].includes(element.tagName)) {
        element.remove();
        continue;
      }
      clean(element);
      if (!NOTE_TAGS.has(element.tagName)) {
        element.replaceWith(...Array.from(element.childNodes));
        continue;
      }
      for (const attribute of Array.from(element.attributes)) {
        element.removeAttribute(attribute.name);
      }
    }
  };

  clean(template.content);
  const probe = document.createElement("div");
  probe.append(template.content.cloneNode(true));
  return probe.textContent?.trim() ? template.innerHTML.trim() : "";
}

function plainTextToNoteHtml(value: string) {
  if (!value) return "";
  if (typeof document === "undefined") {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
  const probe = document.createElement("div");
  probe.textContent = value;
  return probe.innerHTML;
}

function notePlainText(value: string) {
  if (!value) return "";
  if (typeof document === "undefined") return value.replace(/<[^>]*>/g, " ");
  const probe = document.createElement("div");
  probe.innerHTML = sanitizeNoteHtml(value);
  return probe.textContent ?? "";
}

function RichTextNote({ value, className = "" }: { value: string; className?: string }) {
  return (
    <div
      className={`rich-note ${className}`.trim()}
      dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(value) }}
    />
  );
}

function RichTextEditor({
  value,
  onChange,
  autoFocus = false,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  placeholder: string;
  ariaLabel: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.innerHTML !== value) editor.innerHTML = sanitizeNoteHtml(value);
  }, [value]);

  useEffect(() => {
    if (autoFocus) editorRef.current?.focus();
  }, [autoFocus]);

  function publish() {
    const editor = editorRef.current;
    if (editor) onChange(sanitizeNoteHtml(editor.innerHTML));
  }

  function format(command: "bold" | "underline" | "insertUnorderedList" | "insertOrderedList") {
    editorRef.current?.focus();
    document.execCommand(command);
    publish();
  }

  function pastePlainText(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
    publish();
  }

  return (
    <div className="rich-editor">
      <div className="rich-editor-toolbar" role="toolbar" aria-label="备注格式">
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => format("bold")} aria-label="粗体"><strong>B</strong></button>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => format("underline")} aria-label="下划线"><u>U</u></button>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => format("insertUnorderedList")} aria-label="项目符号列表">• 列表</button>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => format("insertOrderedList")} aria-label="数字列表">1. 列表</button>
      </div>
      <div
        ref={editorRef}
        className="rich-editor-input"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label={ariaLabel}
        aria-multiline="true"
        data-placeholder={placeholder}
        onInput={publish}
        onBlur={publish}
        onPaste={pastePlainText}
      />
    </div>
  );
}

function createInitialWorkspace(): Workspace {
  const now = Date.now();
  return {
    schemaVersion: SCHEMA_VERSION,
    focusEndsAt: null,
    lastLandingAt: null,
    tasks: [
      {
        id: "quarterly-report",
        title: "整理季度合规报告",
        note: "今天 15:00 前发给林然；表 1、2 已复核",
        status: "active",
        createdAt: now - 2 * 24 * 60 * 60_000,
        updatedAt: now - 27 * 60_000,
        returnAt: null,
        totalSeconds: 28 * 60 + 14,
        startedAt: now,
      },
      {
        id: "invoice",
        title: "补交 6 月发票",
        note: "发票已上传，正在等财务确认代码",
        status: "later",
        createdAt: now - 24 * 60 * 60_000,
        updatedAt: now - 52 * 60_000,
        returnAt: now + 58 * 60_000,
        totalSeconds: 11 * 60,
        startedAt: null,
      },
      {
        id: "login-error",
        title: "定位登录失败问题",
        note: "只发生在新注册账号",
        status: "later",
        createdAt: now - 3 * 60 * 60_000,
        updatedAt: now - 73 * 60_000,
        returnAt: now + 2 * 60 * 60_000,
        totalSeconds: 19 * 60,
        startedAt: null,
      },
      {
        id: "friday-share",
        title: "准备周五分享",
        note: "主题已定，素材还没收拢",
        status: "later",
        createdAt: now - 4 * 24 * 60 * 60_000,
        updatedAt: now - 21 * 60 * 60_000,
        returnAt: now + 24 * 60 * 60_000,
        totalSeconds: 26 * 60,
        startedAt: null,
      },
      {
        id: "audit-index",
        title: "更新审计证据目录",
        note: "前 17 行已核对，第 21 行可能缺附件",
        status: "later",
        createdAt: now - 8 * 24 * 60 * 60_000,
        updatedAt: now - 3 * 24 * 60 * 60_000,
        returnAt: now - 18 * 60_000,
        totalSeconds: 42 * 60,
        startedAt: null,
      },
    ],
  };
}

function normalizeWorkspace(value: unknown): Workspace {
  if (!value || typeof value !== "object") return createInitialWorkspace();
  const raw = value as Record<string, unknown>;
  const now = Date.now();
  const isCurrentSchema = raw.schemaVersion === SCHEMA_VERSION;
  const rawTasks = isCurrentSchema && Array.isArray(raw.tasks)
    ? raw.tasks
    : Array.isArray(raw.threads)
      ? raw.threads
      : Array.isArray(raw.tasks)
        ? raw.tasks
        : [];
  const legacyActiveId = asText(raw.activeTaskId) || asText(raw.activeId);
  let activeSeen = false;
  const usedIds = new Set<string>();

  const tasks: Task[] = rawTasks.map((entry, index) => {
    const item = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    let id = asText(item.id) || uid(`task-${index}`);
    while (usedIds.has(id)) id = uid("task");
    usedIds.add(id);
    const rawStatus = asText(item.status);
    let status: TaskStatus = "later";
    if (rawStatus === "done") {
      status = "done";
    } else if (!activeSeen && (rawStatus === "active" || id === legacyActiveId)) {
      status = "active";
      activeSeen = true;
    }

    return {
      id,
      title: asText(item.title) || "未命名任务",
      note: isCurrentSchema
        ? sanitizeNoteHtml(asText(item.note))
        : plainTextToNoteHtml(
            asText(item.note) ||
            asText(item.nextStep) ||
            asText(item.checkpoint) ||
            asText(item.outcome),
          ),
      status,
      createdAt: asNumber(item.createdAt, now),
      updatedAt: asNumber(item.updatedAt, now),
      returnAt: status !== "done" && typeof item.returnAt === "number" && Number.isFinite(item.returnAt)
        ? item.returnAt
        : null,
      totalSeconds: asNumber(item.totalSeconds, 0),
      startedAt: status === "active" ? asNumber(item.startedAt, now) : null,
    };
  });

  if (!isCurrentSchema && Array.isArray(raw.sparks)) {
    for (const entry of raw.sparks) {
      const item = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
      const title = asText(item.text).trim();
      if (!title) continue;
      let id = asText(item.id) || uid("task");
      while (usedIds.has(id)) id = uid("task");
      usedIds.add(id);
      tasks.push({
        id,
        title,
        note: "",
        status: "later",
        createdAt: asNumber(item.createdAt, now),
        updatedAt: asNumber(item.createdAt, now),
        returnAt: null,
        totalSeconds: 0,
        startedAt: null,
      });
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    tasks,
    focusEndsAt: typeof raw.focusEndsAt === "number" ? raw.focusEndsAt : null,
    lastLandingAt: typeof raw.lastLandingAt === "number" ? raw.lastLandingAt : null,
  };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readWorkspace(): Promise<unknown | null> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(WORKSPACE_KEY);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
}

async function writeWorkspace(workspace: Workspace): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(workspace, WORKSPACE_KEY);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function returnText(returnAt: number | null, now: number) {
  if (!returnAt) return "稍后";
  const diff = returnAt - now;
  if (diff <= 0) return "提醒到了";
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `${minutes} 分钟后`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} 小时后`;
  const date = new Date(returnAt);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function nextReturn(choice: string) {
  const now = new Date();
  if (choice === "hour") return now.getTime() + 60 * 60_000;
  if (choice === "later") return now.getTime() + 3 * 60 * 60_000;
  if (choice === "tomorrow") {
    now.setDate(now.getDate() + 1);
    now.setHours(10, 30, 0, 0);
    return now.getTime();
  }
  return null;
}

function datetimeLocalValue(timestamp: number | null) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(timestamp - offset).toISOString().slice(0, 16);
}

function reminderTimeText(timestamp: number) {
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sessionSeconds(task: Task, now: number) {
  return task.startedAt ? Math.max(0, Math.floor((now - task.startedAt) / 1000)) : 0;
}

export default function Home() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [now, setNow] = useState(0);
  const [quickTaskTitle, setQuickTaskTitle] = useState("");
  const [managerTaskTitle, setManagerTaskTitle] = useState("");
  const [taskSearch, setTaskSearch] = useState("");
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("open");
  const [switchTarget, setSwitchTarget] = useState<SwitchTarget>(null);
  const [switchDraftSourceId, setSwitchDraftSourceId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [editDrafts, setEditDrafts] = useState<Record<string, EditDraft>>({});
  const [showLanding, setShowLanding] = useState(false);
  const [showTaskManager, setShowTaskManager] = useState(false);
  const [showSwitchChooser, setShowSwitchChooser] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const [importDraft, setImportDraft] = useState<ImportDraft | null>(null);
  const [backupError, setBackupError] = useState("");
  const [currentNoteDraft, setCurrentNoteDraft] = useState("");
  const [returnChoice, setReturnChoice] = useState("none");
  const [newTitle, setNewTitle] = useState("");
  const [toast, setToast] = useState("");
  const [lastDeleted, setLastDeleted] = useState<DeletedTask | null>(null);
  const [reminderTaskId, setReminderTaskId] = useState<string | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
  const quickTaskInput = useRef<HTMLInputElement>(null);
  const reminderDateInput = useRef<HTMLInputElement>(null);
  const backupFileInput = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | null>(null);
  const shownReminders = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    readWorkspace()
      .then((saved) => {
        if (cancelled) return;
        setNow(Date.now());
        setWorkspace(saved ? normalizeWorkspace(saved) : createInitialWorkspace());
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError(true);
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (ready && workspace) writeWorkspace(workspace).catch(() => undefined);
  }, [workspace, ready]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isTyping = target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (event.key === "/" && !isTyping && !switchTarget && !editTarget && !showLanding && !showTaskManager && !showSwitchChooser && !showBackup && !reminderTaskId) {
        event.preventDefault();
        quickTaskInput.current?.focus();
      }
      if (event.key === "Escape") {
        if (showBackup) {
          setShowBackup(false);
          setImportDraft(null);
          setBackupError("");
          return;
        }
        if (reminderTaskId) {
          setReminderTaskId(null);
          return;
        }
        if (editTarget) {
          setEditTarget(null);
          return;
        }
        if (switchTarget) {
          setSwitchTarget(null);
          return;
        }
        if (showLanding) {
          setShowLanding(false);
          return;
        }
        if (showSwitchChooser) {
          setShowSwitchChooser(false);
          return;
        }
        setSwitchTarget(null);
        setShowTaskManager(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [switchTarget, editTarget, showLanding, showTaskManager, showSwitchChooser, showBackup, reminderTaskId]);

  const activeTask = useMemo(
    () => workspace?.tasks.find((task) => task.status === "active") ?? null,
    [workspace],
  );

  const laterTasks = useMemo(() => {
    if (!workspace) return [];
    return workspace.tasks.filter((task) => task.status === "later");
  }, [workspace]);

  const managedTasks = useMemo(() => {
    if (!workspace) return [];
    const query = taskSearch.trim().toLocaleLowerCase("zh-CN");
    return workspace.tasks
      .filter((task) => taskFilter === "done" ? task.status === "done" : task.status !== "done")
      .filter((task) => !query || `${task.title} ${notePlainText(task.note)}`.toLocaleLowerCase("zh-CN").includes(query))
      .sort((a, b) => {
        const rank = (task: Task) => task.status === "active" ? 0 : task.status === "later" ? 1 : 2;
        return rank(a) - rank(b) || b.updatedAt - a.updatedAt;
      });
  }, [workspace, taskFilter, taskSearch]);

  const editingTask = editTarget
    ? workspace?.tasks.find((task) => task.id === editTarget.id) ?? null
    : null;
  const editingDraft = editTarget ? editDrafts[editTarget.id] ?? null : null;
  const reminderTask = reminderTaskId
    ? workspace?.tasks.find((task) => task.id === reminderTaskId) ?? null
    : null;
  const switchTask = switchTarget?.mode === "task"
    ? workspace?.tasks.find((task) => task.id === switchTarget.id) ?? null
    : null;

  useEffect(() => {
    if (
      !workspace ||
      reminderTaskId ||
      switchTarget ||
      editTarget ||
      showLanding ||
      showTaskManager ||
      showSwitchChooser ||
      showBackup
    ) return;

    const dueTask = workspace.tasks.find((task) => {
      if (task.status !== "later" || task.returnAt === null || task.returnAt > now) return false;
      return !shownReminders.current.has(`${task.id}:${task.returnAt}`);
    });
    if (!dueTask || dueTask.returnAt === null) return;
    shownReminders.current.add(`${dueTask.id}:${dueTask.returnAt}`);
    setReminderTaskId(dueTask.id);
  }, [
    workspace,
    now,
    reminderTaskId,
    switchTarget,
    editTarget,
    showLanding,
    showTaskManager,
    showSwitchChooser,
    showBackup,
  ]);

  function showToast(message: string, deleted: DeletedTask | null = null) {
    setToast(message);
    setLastDeleted(deleted);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      setToast("");
      setLastDeleted(null);
    }, deleted ? 6000 : 2600);
  }

  function updateWorkspace(mutator: (current: Workspace) => Workspace) {
    setWorkspace((current) => (current ? mutator(current) : current));
  }

  function reorderLaterTask(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    updateWorkspace((current) => {
      const reordered = current.tasks.filter((task) => task.status === "later");
      const sourceIndex = reordered.findIndex((task) => task.id === sourceId);
      const targetIndex = reordered.findIndex((task) => task.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const [moved] = reordered.splice(sourceIndex, 1);
      reordered.splice(targetIndex, 0, moved);
      let laterIndex = 0;
      return {
        ...current,
        tasks: current.tasks.map((task) =>
          task.status === "later" ? reordered[laterIndex++] : task,
        ),
      };
    });
  }

  function dropLaterTask(event: DragEvent, targetId: string) {
    event.preventDefault();
    const sourceId = draggingTaskId || event.dataTransfer.getData("text/plain");
    if (sourceId) reorderLaterTask(sourceId, targetId);
    setDraggingTaskId(null);
    setDragOverTaskId(null);
  }

  function moveLaterTaskWithKeyboard(event: ReactKeyboardEvent, taskId: string) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const index = laterTasks.findIndex((task) => task.id === taskId);
    const target = laterTasks[index + (event.key === "ArrowUp" ? -1 : 1)];
    if (target) reorderLaterTask(taskId, target.id);
  }

  function addTask(title: string) {
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    const currentTime = Date.now();
    updateWorkspace((current) => ({
      ...current,
      tasks: [
        {
          id: uid("task"),
          title: cleanTitle,
          note: "",
          status: "later",
          createdAt: currentTime,
          updatedAt: currentTime,
          returnAt: null,
          totalSeconds: 0,
          startedAt: null,
        },
        ...current.tasks,
      ],
    }));
    showToast(`已添加「${cleanTitle}」`);
  }

  function addQuickTask(event: FormEvent) {
    event.preventDefault();
    addTask(quickTaskTitle);
    setQuickTaskTitle("");
  }

  function addManagerTask(event: FormEvent) {
    event.preventDefault();
    addTask(managerTaskTitle);
    setManagerTaskTitle("");
    setTaskSearch("");
    setTaskFilter("open");
  }

  function activateTask(taskId: string) {
    const currentTime = Date.now();
    updateWorkspace((current) => ({
      ...current,
      focusEndsAt: null,
      tasks: current.tasks.map((task) => {
        if (task.id === taskId) {
          return {
            ...task,
            status: "active",
            returnAt: null,
            updatedAt: currentTime,
            startedAt: currentTime,
          };
        }
        if (task.status === "active") {
          return {
            ...task,
            status: "later",
            updatedAt: currentTime,
            totalSeconds: task.totalSeconds + sessionSeconds(task, currentTime),
            startedAt: null,
          };
        }
        return task;
      }),
    }));
    showToast("已切换任务");
  }

  function beginSwitch(target: Exclude<SwitchTarget, null>) {
    if (target.mode === "task" && (!activeTask || activeTask.id === target.id)) {
      if (activeTask?.id !== target.id) activateTask(target.id);
      return;
    }
    const sourceId = activeTask?.id ?? null;
    if (switchDraftSourceId !== sourceId) {
      setCurrentNoteDraft(activeTask?.note ?? "");
      setReturnChoice("none");
      setSwitchDraftSourceId(sourceId);
    }
    if (target.mode === "new" && target.title && !newTitle.trim()) {
      setNewTitle(target.title);
    }
    setSwitchTarget(target);
  }

  function confirmSwitch(event: FormEvent) {
    event.preventDefault();
    if (!switchTarget) return;
    if (switchTarget.mode === "new" && !newTitle.trim()) return;
    const currentTime = Date.now();

    updateWorkspace((current) => {
      let tasks = current.tasks.map((task) => {
        if (task.status !== "active") return task;
        return {
          ...task,
          status: "later" as const,
          note: sanitizeNoteHtml(currentNoteDraft),
          returnAt: nextReturn(returnChoice),
          updatedAt: currentTime,
          totalSeconds: task.totalSeconds + sessionSeconds(task, currentTime),
          startedAt: null,
        };
      });

      if (switchTarget.mode === "task") {
        tasks = tasks.map((task) =>
          task.id === switchTarget.id
            ? {
                ...task,
                status: "active" as const,
                returnAt: null,
                updatedAt: currentTime,
                startedAt: currentTime,
              }
            : task,
        );
      } else {
        tasks.unshift({
          id: uid("task"),
          title: newTitle.trim(),
          note: "",
          status: "active",
          createdAt: currentTime,
          updatedAt: currentTime,
          returnAt: null,
          totalSeconds: 0,
          startedAt: currentTime,
        });
      }

      return { ...current, tasks, focusEndsAt: null };
    });

    const createdNewTask = switchTarget.mode === "new";
    setSwitchTarget(null);
    setSwitchDraftSourceId(null);
    setCurrentNoteDraft("");
    setReturnChoice("none");
    if (createdNewTask) {
      setNewTitle("");
    }
    showToast("已保存并切换");
  }

  function openTaskEditor(taskId: string, focus: EditTarget["focus"] = "title") {
    const task = workspace?.tasks.find((item) => item.id === taskId);
    if (!task) return;
    setEditDrafts((current) => current[taskId]
      ? current
      : { ...current, [taskId]: { title: task.title, note: task.note, returnAt: task.returnAt } });
    setEditTarget({ id: taskId, focus });
  }

  function updateEditDraft(field: "title" | "note", value: string) {
    if (!editTarget) return;
    setEditDrafts((current) => {
      const currentDraft = current[editTarget.id];
      return {
        ...current,
        [editTarget.id]: {
          title: currentDraft?.title ?? editingTask?.title ?? "",
          note: currentDraft?.note ?? editingTask?.note ?? "",
          returnAt: currentDraft ? currentDraft.returnAt : editingTask?.returnAt ?? null,
          [field]: value,
        },
      };
    });
  }

  function updateEditReminder(returnAt: number | null) {
    if (!editTarget) return;
    setEditDrafts((current) => ({
      ...current,
      [editTarget.id]: {
        title: current[editTarget.id]?.title ?? editingTask?.title ?? "",
        note: current[editTarget.id]?.note ?? editingTask?.note ?? "",
        returnAt,
      },
    }));
  }

  function saveTaskEdit(event: FormEvent) {
    event.preventDefault();
    if (!editTarget || !editingDraft?.title.trim()) return;
    const taskId = editTarget.id;
    updateWorkspace((current) => ({
      ...current,
      tasks: current.tasks.map((task) => task.id === taskId
        ? {
            ...task,
            title: editingDraft.title.trim(),
            note: sanitizeNoteHtml(editingDraft.note),
            returnAt: task.status === "done" ? null : editingDraft.returnAt,
          }
        : task),
    }));
    setEditDrafts((current) => {
      const next = { ...current };
      delete next[taskId];
      return next;
    });
    setEditTarget(null);
    if (switchDraftSourceId === taskId) setSwitchDraftSourceId(null);
    showToast("任务已保存");
  }

  function startFocus() {
    if (!workspace || !activeTask) return;
    if (workspace.focusEndsAt && workspace.focusEndsAt > now) {
      updateWorkspace((current) => ({ ...current, focusEndsAt: null }));
      showToast("计时已结束");
      return;
    }
    updateWorkspace((current) => ({ ...current, focusEndsAt: Date.now() + 10 * 60_000 }));
    showToast("先做 10 分钟");
  }

  function moveTaskToLater(taskId: string) {
    const currentTime = Date.now();
    updateWorkspace((current) => ({
      ...current,
      focusEndsAt: null,
      tasks: current.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status: "later",
              updatedAt: currentTime,
              totalSeconds: task.totalSeconds + sessionSeconds(task, currentTime),
              startedAt: null,
            }
          : task,
      ),
    }));
    showToast("已放到稍后");
  }

  function completeTask(taskId: string) {
    const currentTime = Date.now();
    updateWorkspace((current) => ({
      ...current,
      focusEndsAt: current.tasks.some((task) => task.id === taskId && task.status === "active")
        ? null
        : current.focusEndsAt,
      tasks: current.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status: "done",
              returnAt: null,
              updatedAt: currentTime,
              totalSeconds: task.totalSeconds + sessionSeconds(task, currentTime),
              startedAt: null,
            }
          : task,
      ),
    }));
    showToast("已完成");
  }

  function restoreTask(taskId: string) {
    updateWorkspace((current) => ({
      ...current,
      tasks: current.tasks.map((task) =>
        task.id === taskId
          ? { ...task, status: "later", returnAt: null, updatedAt: Date.now(), startedAt: null }
          : task,
      ),
    }));
    showToast("已重新打开");
  }

  function snoozeTask(taskId: string) {
    updateWorkspace((current) => ({
      ...current,
      tasks: current.tasks.map((task) =>
        task.id === taskId
          ? { ...task, returnAt: Date.now() + 2 * 60 * 60_000, updatedAt: Date.now() }
          : task,
      ),
    }));
    showToast("2 小时后再提醒");
  }

  function clearTaskReminder(taskId: string) {
    updateWorkspace((current) => ({
      ...current,
      tasks: current.tasks.map((task) =>
        task.id === taskId ? { ...task, returnAt: null, updatedAt: Date.now() } : task,
      ),
    }));
    showToast("提醒已关闭");
  }

  function deleteTask(taskId: string) {
    if (!workspace) return;
    const index = workspace.tasks.findIndex((task) => task.id === taskId);
    if (index < 0) return;
    const task = workspace.tasks[index];
    const currentTime = Date.now();
    const wasActive = task.status === "active";
    const savedTask = wasActive
      ? {
          ...task,
          totalSeconds: task.totalSeconds + sessionSeconds(task, currentTime),
          updatedAt: currentTime,
          startedAt: null,
        }
      : task;
    const deleted: DeletedTask = { task: savedTask, index, wasActive };
    updateWorkspace((current) => ({
      ...current,
      focusEndsAt: deleted.wasActive ? null : current.focusEndsAt,
      tasks: current.tasks.filter((item) => item.id !== taskId),
    }));
    setEditDrafts((current) => {
      if (!current[taskId]) return current;
      const next = { ...current };
      delete next[taskId];
      return next;
    });
    if (editTarget?.id === taskId) setEditTarget(null);
    showToast(`已删除「${task.title}」`, deleted);
  }

  function undoDelete() {
    if (!lastDeleted) return;
    const deleted = lastDeleted;
    const currentTime = Date.now();
    updateWorkspace((current) => {
      const tasks = current.tasks.map((task) =>
        deleted.wasActive && task.status === "active"
          ? {
              ...task,
              status: "later" as const,
              totalSeconds: task.totalSeconds + sessionSeconds(task, currentTime),
              updatedAt: currentTime,
              startedAt: null,
            }
          : task,
      );
      const restored = deleted.wasActive
        ? { ...deleted.task, status: "active" as const, updatedAt: currentTime, startedAt: currentTime }
        : deleted.task;
      tasks.splice(Math.min(deleted.index, tasks.length), 0, restored);
      return { ...current, focusEndsAt: deleted.wasActive ? null : current.focusEndsAt, tasks };
    });
    setLastDeleted(null);
    setToast("");
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }

  function exportBackup() {
    if (!workspace) return;
    const blob = new Blob([JSON.stringify(workspace, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `续线备份-${datetimeLocalValue(Date.now()).slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("备份文件已下载");
  }

  function closeBackup() {
    setShowBackup(false);
    setImportDraft(null);
    setBackupError("");
  }

  async function readBackupFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBackupError("");

    try {
      const raw = JSON.parse(await file.text()) as Record<string, unknown>;
      if (raw.schemaVersion !== SCHEMA_VERSION || !Array.isArray(raw.tasks)) {
        throw new Error("invalid backup");
      }
      setImportDraft({
        workspace: normalizeWorkspace(raw),
        fileName: file.name,
      });
    } catch {
      setImportDraft(null);
      setBackupError("无法读取这个文件，请选择由续线导出的 JSON 备份。");
    }
  }

  function confirmImport() {
    if (!importDraft) return;
    setWorkspace(importDraft.workspace);
    setNow(Date.now());
    shownReminders.current.clear();
    const taskCount = importDraft.workspace.tasks.length;
    closeBackup();
    showToast(`已导入 ${taskCount} 个任务`);
  }

  function finishLanding(event: FormEvent) {
    event.preventDefault();
    updateWorkspace((current) => ({ ...current, lastLandingAt: Date.now() }));
    setShowLanding(false);
    showToast("已保存，今天到这里");
  }

  if (loadError) {
    return (
      <main className="loading-screen" aria-label="无法读取本地任务">
        <p>无法读取本地任务。你的数据没有被改动。</p>
        <button className="primary-action" type="button" onClick={() => window.location.reload()}>重新打开</button>
      </main>
    );
  }

  if (!workspace || !ready) {
    return (
      <main className="loading-screen" aria-label="正在打开续线">
        <span className="loading-dot" aria-hidden="true" />
        <p>正在打开…</p>
      </main>
    );
  }

  const focusRemaining = workspace.focusEndsAt ? Math.max(0, Math.ceil((workspace.focusEndsAt - now) / 1000)) : 0;
  const openTaskCount = workspace.tasks.filter((task) => task.status !== "done").length;
  const doneTaskCount = workspace.tasks.filter((task) => task.status === "done").length;
  const shownLaterTasks = laterTasks.slice(0, 2);
  const hiddenLaterTasks = laterTasks.slice(2);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top"><span aria-hidden="true" />续线</a>
        <div className="topbar-actions">
          <button className="task-manager-button" type="button" onClick={() => setShowTaskManager(true)}>
            全部任务 <span>{openTaskCount}</span>
          </button>
          <button className="text-button" type="button" onClick={() => setShowBackup(true)}>备份&amp;恢复</button>
          <button className="text-button" type="button" onClick={() => setShowLanding(true)}>结束今天</button>
        </div>
      </header>

      <section className="capture-wrap" id="top" aria-label="快速添加任务">
        <form className="capture-form" onSubmit={addQuickTask}>
          <span className="capture-plus" aria-hidden="true">＋</span>
          <input
            ref={quickTaskInput}
            value={quickTaskTitle}
            onChange={(event) => setQuickTaskTitle(event.target.value)}
            placeholder="快速添加任务，回车保存"
            aria-label="快速添加任务"
          />
          <kbd>/</kbd>
          <button type="submit" disabled={!quickTaskTitle.trim()}>添加</button>
        </form>
      </section>

      <div className="workspace-grid">
        <section className="current-card" aria-labelledby="current-title">
          {activeTask ? (
            <>
              <div className="current-header">
                <p className="section-label" id="current-title"><i aria-hidden="true" />现在</p>
                {focusRemaining > 0 && <span className="focus-badge">还剩 {formatDuration(focusRemaining)}</span>}
              </div>

              <div className="current-main">
                <div className="next-step task-unit">
                  <div className="current-task-tools" aria-label="编辑当前任务">
                    <button type="button" onClick={() => openTaskEditor(activeTask.id)}>编辑</button>
                    <button type="button" onClick={() => moveTaskToLater(activeTask.id)}>放到稍后</button>
                  </div>
                  <span>正在做</span>
                  <strong>{activeTask.title}</strong>
                  {activeTask.note
                    ? <RichTextNote value={activeTask.note} />
                    : <button className="current-add-note" type="button" onClick={() => openTaskEditor(activeTask.id, "note")}>＋ 添加备注</button>}
                </div>
              </div>

              <div className="current-actions">
                <button className="primary-action" type="button" onClick={startFocus}>
                  {focusRemaining > 0 ? `结束计时 · ${formatDuration(focusRemaining)}` : "开始 10 分钟"}
                </button>
                <button className="switch-action" type="button" onClick={() => setShowSwitchChooser(true)}>
                  换一件事
                </button>
                <button className="complete-action" type="button" onClick={() => completeTask(activeTask.id)}>完成</button>
              </div>
            </>
          ) : (
            <div className="empty-current">
              <p className="section-label"><i aria-hidden="true" />现在</p>
              <h1>现在没有任务</h1>
              <p>从右侧选一个，或者开始一件新事。</p>
              <button className="primary-action" type="button" onClick={() => beginSwitch({ mode: "new" })}>开始一件事</button>
            </div>
          )}
        </section>

        <aside className="later-panel" aria-labelledby="later-title">
          <div className="later-header">
            <div>
              <p className="section-label" id="later-title">稍后</p>
              <h2>还要继续</h2>
            </div>
            <button className="view-all-button" type="button" onClick={() => setShowTaskManager(true)}>查看全部</button>
          </div>

          <div className="later-list">
            {shownLaterTasks.map((task) => {
              const due = task.returnAt !== null && task.returnAt <= now;
              return (
                <div
                  className={`later-item task-unit ${due ? "is-due" : ""} ${draggingTaskId === task.id ? "is-dragging" : ""} ${dragOverTaskId === task.id ? "is-drag-over" : ""}`}
                  key={task.id}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDragOverTaskId(task.id);
                  }}
                  onDrop={(event) => dropLaterTask(event, task.id)}
                >
                  <button
                    className="later-drag-handle"
                    type="button"
                    draggable
                    aria-label={`拖动排序：${task.title}`}
                    title="拖动排序，也可用上下方向键"
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", task.id);
                      setDraggingTaskId(task.id);
                    }}
                    onDragEnd={() => {
                      setDraggingTaskId(null);
                      setDragOverTaskId(null);
                    }}
                    onKeyDown={(event) => moveLaterTaskWithKeyboard(event, task.id)}
                  >
                    ⋮⋮
                  </button>
                  <div
                    className="later-item-main"
                    role="button"
                    tabIndex={0}
                    aria-label={`切换到任务：${task.title}`}
                    onClick={() => beginSwitch({ mode: "task", id: task.id })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        beginSwitch({ mode: "task", id: task.id });
                      }
                    }}
                  >
                    <span className="later-next">{task.title}</span>
                    {task.note && (
                      <span className="later-note" title={notePlainText(task.note)}>
                        {notePlainText(task.note)}
                      </span>
                    )}
                    <span className="later-meta">{returnText(task.returnAt, now)}</span>
                  </div>
                  <div className="later-item-actions">
                    <button className="later-edit-button" type="button" onClick={() => openTaskEditor(task.id, "note")}>
                      编辑
                    </button>
                    {due && <button className="snooze-button" type="button" onClick={() => snoozeTask(task.id)}>2 小时后</button>}
                  </div>
                </div>
              );
            })}

            {hiddenLaterTasks.length > 0 && (
              <details className="more-tasks">
                <summary>还有 {hiddenLaterTasks.length} 件</summary>
                {hiddenLaterTasks.map((task) => (
                  <div
                    className={`later-item task-unit ${draggingTaskId === task.id ? "is-dragging" : ""} ${dragOverTaskId === task.id ? "is-drag-over" : ""}`}
                    key={task.id}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDragOverTaskId(task.id);
                    }}
                    onDrop={(event) => dropLaterTask(event, task.id)}
                  >
                    <button
                      className="later-drag-handle"
                      type="button"
                      draggable
                      aria-label={`拖动排序：${task.title}`}
                      title="拖动排序，也可用上下方向键"
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", task.id);
                        setDraggingTaskId(task.id);
                      }}
                      onDragEnd={() => {
                        setDraggingTaskId(null);
                        setDragOverTaskId(null);
                      }}
                      onKeyDown={(event) => moveLaterTaskWithKeyboard(event, task.id)}
                    >
                      ⋮⋮
                    </button>
                    <div
                      className="later-item-main"
                      role="button"
                      tabIndex={0}
                      aria-label={`切换到任务：${task.title}`}
                      onClick={() => beginSwitch({ mode: "task", id: task.id })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          beginSwitch({ mode: "task", id: task.id });
                        }
                      }}
                    >
                      <span className="later-next">{task.title}</span>
                      {task.note && (
                        <span className="later-note" title={notePlainText(task.note)}>
                          {notePlainText(task.note)}
                        </span>
                      )}
                      <span className="later-meta">{returnText(task.returnAt, now)}</span>
                    </div>
                    <div className="later-item-actions">
                      <button className="later-edit-button" type="button" onClick={() => openTaskEditor(task.id, "note")}>
                        编辑
                      </button>
                    </div>
                  </div>
                ))}
              </details>
            )}

            {laterTasks.length === 0 && <p className="empty-later">没有稍后任务。</p>}
          </div>
        </aside>
      </div>

      {showBackup && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeBackup()}>
          <section className="modal-card backup-modal" role="dialog" aria-modal="true" aria-labelledby="backup-title">
            <button className="modal-close" type="button" onClick={closeBackup} aria-label="关闭">×</button>
            <h2 id="backup-title">{importDraft ? "确认导入" : "备份数据"}</h2>
            <p className="modal-lede">
              {importDraft
                ? "确认后，当前浏览器中的任务会被备份内容替换。"
                : "下载当前任务记录，或从续线备份中恢复。"}
            </p>

            {importDraft ? (
              <>
                <div className="import-summary">
                  <span>将导入</span>
                  <strong>{importDraft.workspace.tasks.length} 个任务</strong>
                  <small>{importDraft.fileName}</small>
                </div>
                <p className="import-warning">当前任务将被覆盖，且无法撤销。需要保留时，请先导出备份。</p>
                <div className="modal-actions">
                  <button type="button" onClick={() => setImportDraft(null)}>返回</button>
                  <button className="confirm-button" type="button" onClick={confirmImport}>覆盖并导入</button>
                </div>
              </>
            ) : (
              <>
                <div className="backup-options">
                  <button
                    type="button"
                    onClick={() => {
                      exportBackup();
                      closeBackup();
                    }}
                  >
                    <strong>导出备份</strong>
                    <span>下载全部任务记录</span>
                  </button>
                  <button type="button" onClick={() => backupFileInput.current?.click()}>
                    <strong>导入备份</strong>
                    <span>选择 JSON 文件并覆盖当前数据</span>
                  </button>
                </div>
                <input
                  ref={backupFileInput}
                  className="backup-file-input"
                  type="file"
                  accept=".json,application/json"
                  onChange={readBackupFile}
                />
                {backupError && <p className="backup-error" role="alert">{backupError}</p>}
              </>
            )}
          </section>
        </div>
      )}

      {reminderTask && (
        <div className="modal-backdrop is-elevated" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setReminderTaskId(null)}>
          <section className="modal-card reminder-popup" role="alertdialog" aria-modal="true" aria-labelledby="reminder-popup-title">
            <button className="modal-close" type="button" onClick={() => setReminderTaskId(null)} aria-label="暂时关闭">×</button>
            <h2 id="reminder-popup-title">提醒时间到了</h2>
            <p className="modal-lede">这件事可能需要尽快处理。</p>
            <div className="reminder-popup-task">
              <strong>{reminderTask.title}</strong>
              {reminderTask.note && <RichTextNote value={reminderTask.note} />}
            </div>
            <div className="modal-actions reminder-popup-actions">
              <button
                type="button"
                onClick={() => {
                  clearTaskReminder(reminderTask.id);
                  setReminderTaskId(null);
                }}
              >
                关闭提醒
              </button>
              <button
                type="button"
                onClick={() => {
                  snoozeTask(reminderTask.id);
                  setReminderTaskId(null);
                }}
              >
                2 小时后
              </button>
              <button
                className="confirm-button"
                type="button"
                onClick={() => {
                  setReminderTaskId(null);
                  beginSwitch({ mode: "task", id: reminderTask.id });
                }}
              >
                现在处理
              </button>
            </div>
          </section>
        </div>
      )}

      {showSwitchChooser && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowSwitchChooser(false)}>
          <section className="modal-card switch-chooser" role="dialog" aria-modal="true" aria-labelledby="switch-chooser-title">
            <button className="modal-close" type="button" onClick={() => setShowSwitchChooser(false)} aria-label="关闭">×</button>
            <h2 id="switch-chooser-title">接下来做什么？</h2>
            <p className="modal-lede">从稍后任务中选择，或者开始一件新事。</p>

            <div className="switch-choice-list">
              {laterTasks.map((task) => (
                <button
                  className="switch-choice"
                  type="button"
                  key={task.id}
                  onClick={() => {
                    setShowSwitchChooser(false);
                    beginSwitch({ mode: "task", id: task.id });
                  }}
                >
                  <strong>{task.title}</strong>
                  {task.note && <span>{notePlainText(task.note)}</span>}
                  <small>{returnText(task.returnAt, now)}</small>
                </button>
              ))}
              {laterTasks.length === 0 && <p className="switch-choice-empty">稍后栏里还没有任务。</p>}
            </div>

            <button
              className="new-task-choice"
              type="button"
              onClick={() => {
                setShowSwitchChooser(false);
                beginSwitch({ mode: "new" });
              }}
            >
              ＋ 开始一件新事
            </button>
          </section>
        </div>
      )}

      {switchTarget && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSwitchTarget(null)}>
          <section className="modal-card switch-modal" role="dialog" aria-modal="true" aria-labelledby="switch-title">
            <button className="modal-close" type="button" onClick={() => setSwitchTarget(null)} aria-label="关闭">×</button>
            <h2 id="switch-title">{switchTarget.mode === "new" ? "新建并切换" : "切换任务"}</h2>
            <form onSubmit={confirmSwitch}>
              {activeTask ? (
                <div className="switch-route">
                  <div className="switch-route-task">
                    <span>当前任务</span>
                    <strong title={activeTask.title}>{activeTask.title}</strong>
                    <small>将放到稍后</small>
                  </div>
                  <span className="switch-route-arrow" aria-hidden="true">→</span>
                  {switchTarget.mode === "new" ? (
                    <div className="switch-route-task is-target switch-route-new">
                      <span>接下来做</span>
                      <input
                        autoFocus
                        aria-label="新任务名称"
                        value={newTitle}
                        onChange={(event) => setNewTitle(event.target.value)}
                        placeholder="输入新任务名称"
                        required
                      />
                    </div>
                  ) : (
                    <div className="switch-route-task is-target">
                      <span>接下来做</span>
                      <strong title={switchTask?.title}>{switchTask?.title}</strong>
                    </div>
                  )}
                </div>
              ) : (
                switchTarget.mode === "new" && (
                  <label className="new-task-name">
                    <span>任务名称</span>
                    <input
                      autoFocus
                      value={newTitle}
                      onChange={(event) => setNewTitle(event.target.value)}
                      placeholder="要做什么？"
                      required
                    />
                  </label>
                )
              )}

              {activeTask && (
                <div className="switch-away-card">
                  <div className="switch-away-heading">
                    <span>离开当前任务前</span>
                  </div>
                  <details className="switch-away-option">
                    <summary>
                      <span>记录当前任务进度</span>
                      <small>留备注</small>
                    </summary>
                    <div className="switch-away-content">
                      <RichTextEditor
                        value={currentNoteDraft}
                        onChange={setCurrentNoteDraft}
                        placeholder="记录进度，方便回来继续"
                        ariaLabel="被换走任务的备注"
                      />
                    </div>
                  </details>
                  <details className="switch-away-option">
                    <summary>
                      <span>为当前任务设置提醒</span>
                      <small>
                        {returnChoice === "hour"
                          ? "1 小时后提醒我继续"
                          : returnChoice === "later"
                            ? "3 小时后提醒我继续"
                            : returnChoice === "tomorrow"
                              ? "明早 10:30 提醒我继续"
                              : "不提醒"}
                      </small>
                    </summary>
                    <fieldset className="switch-away-content">
                      <legend className="sr-only">提醒时间</legend>
                      <div className="choice-row">
                        {[
                          ["none", "不提醒"],
                          ["hour", "1 小时后"],
                          ["later", "3 小时后"],
                          ["tomorrow", "明早 10:30"],
                        ].map(([value, label]) => (
                          <label className={returnChoice === value ? "selected" : ""} key={value}>
                            <input type="radio" name="return" value={value} checked={returnChoice === value} onChange={(event) => setReturnChoice(event.target.value)} />
                            {label}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </details>
                </div>
              )}

              <div className="modal-actions">
                <button type="button" onClick={() => setSwitchTarget(null)}>取消</button>
                <button className="confirm-button" type="submit">
                  {switchTarget.mode === "task" ? "切换" : "保存并切换"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {showTaskManager && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowTaskManager(false)}>
          <section className="modal-card task-manager" role="dialog" aria-modal="true" aria-labelledby="task-manager-title">
            <button className="modal-close" type="button" onClick={() => setShowTaskManager(false)} aria-label="关闭">×</button>
            <h2 id="task-manager-title">全部任务</h2>
            <p className="modal-lede">当前、稍后和已完成的任务都在这里。</p>

            <form className="manager-add-form" onSubmit={addManagerTask}>
              <input autoFocus value={managerTaskTitle} onChange={(event) => setManagerTaskTitle(event.target.value)} placeholder="添加任务，回车保存" aria-label="添加任务" />
              <button type="submit" disabled={!managerTaskTitle.trim()}>添加</button>
            </form>

            <div className="manager-toolbar">
              <div className="manager-filters" aria-label="筛选任务">
                <button className={taskFilter === "open" ? "selected" : ""} type="button" onClick={() => setTaskFilter("open")}>未完成 {openTaskCount}</button>
                <button className={taskFilter === "done" ? "selected" : ""} type="button" onClick={() => setTaskFilter("done")}>已完成 {doneTaskCount}</button>
              </div>
              <input value={taskSearch} onChange={(event) => setTaskSearch(event.target.value)} placeholder="搜索" aria-label="搜索任务" />
            </div>

            <div className="manager-task-list">
              {managedTasks.map((task) => (
                <article className="manager-task-row task-unit" key={task.id}>
                  <div className="manager-task-copy">
                    <div className="manager-task-title">
                      <span className={`task-status status-${task.status}`}>
                        {task.status === "active" ? "现在" : task.status === "later" ? "稍后" : "完成"}
                      </span>
                      <strong>{task.title}</strong>
                    </div>
                    {task.note && <RichTextNote value={task.note} />}
                  </div>
                  <div className="manager-task-actions">
                    <button type="button" onClick={() => openTaskEditor(task.id)}>编辑</button>
                    {task.status === "later" && (
                      <button type="button" onClick={() => { setShowTaskManager(false); beginSwitch({ mode: "task", id: task.id }); }}>现在做</button>
                    )}
                    {task.status === "active" && <button type="button" onClick={() => moveTaskToLater(task.id)}>放到稍后</button>}
                    {task.status !== "done" && <button type="button" onClick={() => completeTask(task.id)}>完成</button>}
                    {task.status === "done" && <button type="button" onClick={() => restoreTask(task.id)}>重新打开</button>}
                    <button className="delete-task-button" type="button" onClick={() => deleteTask(task.id)}>删除</button>
                  </div>
                </article>
              ))}
              {managedTasks.length === 0 && <p className="manager-empty">这里还没有任务。</p>}
            </div>
          </section>
        </div>
      )}

      {editTarget && editingTask && editingDraft && (
        <div className="modal-backdrop is-elevated" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setEditTarget(null)}>
          <section className="modal-card edit-task-modal" role="dialog" aria-modal="true" aria-labelledby="edit-task-title">
            <button className="modal-close" type="button" onClick={() => setEditTarget(null)} aria-label="关闭">×</button>
            <h2 id="edit-task-title">编辑任务</h2>
            <p className="modal-lede">暂时关闭不会丢失本次修改，点击保存后生效。</p>
            <form onSubmit={saveTaskEdit}>
              <label>
                <span>任务名称</span>
                <input
                  autoFocus={editTarget.focus === "title"}
                  value={editingDraft.title}
                  onChange={(event) => updateEditDraft("title", event.target.value)}
                  required
                />
              </label>
              <div className="form-field">
                <span>备注 <small>可选</small></span>
                <RichTextEditor
                  autoFocus={editTarget.focus === "note"}
                  value={editingDraft.note}
                  onChange={(value) => updateEditDraft("note", value)}
                  placeholder="补充进度、背景或回来时要记住的事"
                  ariaLabel="任务备注"
                />
              </div>
              {editingTask.status !== "done" && (
                <details className="edit-reminder">
                  <summary>
                    <span>提醒</span>
                    <small>
                      {editingDraft.returnAt !== editingTask.returnAt
                        ? editingDraft.returnAt
                          ? `未保存 · ${reminderTimeText(editingDraft.returnAt)}`
                          : "未保存 · 将清除"
                        : editingDraft.returnAt
                          ? `已设置 · ${reminderTimeText(editingDraft.returnAt)}`
                          : "未设置"}
                    </small>
                  </summary>
                  <div className="reminder-settings">
                    <div className="reminder-quick-actions" aria-label="快速设置提醒">
                      <button type="button" onClick={() => updateEditReminder(nextReturn("hour"))}>1 小时后</button>
                      <button type="button" onClick={() => updateEditReminder(nextReturn("later"))}>3 小时后</button>
                      <button type="button" onClick={() => updateEditReminder(nextReturn("tomorrow"))}>明早 10:30</button>
                      {editingDraft.returnAt && (
                        <button className="clear-reminder-button" type="button" onClick={() => updateEditReminder(null)}>清除</button>
                      )}
                    </div>
                    <div className="datetime-picker">
                      <button
                        className="datetime-picker-button"
                        type="button"
                        onClick={() => {
                          const input = reminderDateInput.current;
                          if (!input) return;
                          if (typeof input.showPicker === "function") input.showPicker();
                          else input.focus();
                        }}
                      >
                        <span>
                          {editingDraft.returnAt
                            ? new Date(editingDraft.returnAt).toLocaleString("zh-CN", {
                                year: "numeric",
                                month: "numeric",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "选择具体日期和时间"}
                        </span>
                        <svg className="datetime-picker-icon" viewBox="0 0 24 24" aria-hidden="true">
                          <rect x="3.5" y="5.5" width="17" height="15" rx="2" />
                          <path d="M7.5 3.5v4M16.5 3.5v4M3.5 9.5h17" />
                        </svg>
                      </button>
                      <input
                        ref={reminderDateInput}
                        className="datetime-picker-native"
                        type="datetime-local"
                        aria-label="自定义提醒时间"
                        min={datetimeLocalValue(now)}
                        value={datetimeLocalValue(editingDraft.returnAt)}
                        onChange={(event) => updateEditReminder(event.target.value ? new Date(event.target.value).getTime() : null)}
                      />
                    </div>
                    <small className="reminder-help">
                      {editingDraft.returnAt !== editingTask.returnAt
                        ? editingDraft.returnAt
                          ? `保存后将在 ${reminderTimeText(editingDraft.returnAt)} 弹窗`
                          : "保存后将关闭提醒。"
                        : editingDraft.returnAt
                          ? `将在 ${reminderTimeText(editingDraft.returnAt)} 弹窗`
                          : "可选一个快捷时间，也可以指定准确时间。"}
                    </small>
                  </div>
                </details>
              )}
              <div className="modal-actions">
                <button className="edit-delete-button" type="button" onClick={() => deleteTask(editingTask.id)}>删除任务</button>
                <button type="button" onClick={() => setEditTarget(null)}>先收起</button>
                <button className="confirm-button" type="submit">保存</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {showLanding && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowLanding(false)}>
          <section className="modal-card landing-modal" role="dialog" aria-modal="true" aria-labelledby="landing-title">
            <button className="modal-close" type="button" onClick={() => setShowLanding(false)} aria-label="关闭">×</button>
            <h2 id="landing-title">今天到这里</h2>
            <p className="modal-lede">所有任务都会原样保留，明天打开就能继续。</p>
            <form onSubmit={finishLanding}>
              <div className="modal-actions">
                <button type="button" onClick={() => setShowLanding(false)}>取消</button>
                <button className="confirm-button" type="submit">保存并结束今天</button>
              </div>
            </form>
          </section>
        </div>
      )}

      <div className={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite">
        <span>{toast}</span>
        {lastDeleted && <button type="button" onClick={undoDelete}>撤销</button>}
      </div>
    </main>
  );
}
