'use client';

import { useMemo, useState } from 'react';
import styles from './Sidebar.module.css';
import { CalendarEvent, TodoItem, NotionEntry, CALENDAR_META, formatTime, getConferenceLabel } from '@/lib/mockData';
import { CALENDARS, CalendarSource, TOGGLE_CAL_KEY } from '@/lib/calendarConfig';

type TodoRange = 'today' | 'tomorrow' | 'week' | 'month';

interface SidebarProps {
  currentDate: Date;
  events: CalendarEvent[];
  todos: TodoItem[];
  notionEntries: NotionEntry[];
  todoRange: TodoRange;
  onTodoRangeChange: (range: TodoRange) => void;
  onTodoRefresh: () => Promise<void> | void;
  onTodoToggle: (id: string, done: boolean) => void;
  onTodoDelete: (id: string) => void;
  onTodoCreate: (content: string, dueDate?: string) => Promise<void>;
  onNotionRefresh: () => Promise<void> | void;
  hiddenEvents?: Set<string>;
  onToggleHide?: (id: string) => void;
  taskLinks?: Map<string, string>;
  onToggleTask?: (eventId: string, done: boolean) => void;
  hiddenCalendars?: Set<string>;
  onToggleCalendar?: (cal: string) => void;
}

const RANGE_LABELS: Record<TodoRange, string> = {
  today: 'Today',
  tomorrow: '+1',
  week: 'Week',
  month: 'Month',
};

function filterTodos(todos: TodoItem[], range: TodoRange): TodoItem[] {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  return todos.filter(t => {
    if (!t.due) return false; // no-date tasks hidden from all views
    const dueDate = t.due.split('T')[0];

    if (range === 'today') {
      return dueDate <= todayStr; // overdue + today
    }

    const tomorrowDate = new Date(todayStr);
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowStr = tomorrowDate.toISOString().split('T')[0];

    if (range === 'tomorrow') {
      return dueDate === tomorrowStr;
    }

    // week/month: only future tasks (exclude today and overdue)
    const dueMs = new Date(dueDate).getTime();
    const tomorrowMs = tomorrowDate.getTime();
    const daysDiff = (dueMs - tomorrowMs) / 86400000;

    if (dueDate <= todayStr) return false; // exclude today/overdue
    if (range === 'week') return daysDiff < 7;
    return daysDiff < 30; // month
  });
}

interface TodoTree {
  todo: TodoItem;
  children: TodoItem[];
}

function buildTodoTree(todos: TodoItem[]): TodoTree[] {
  const parentMap = new Map<string, TodoItem[]>();
  const roots: TodoItem[] = [];

  for (const t of todos) {
    if (t.parentId) {
      const children = parentMap.get(t.parentId) || [];
      children.push(t);
      parentMap.set(t.parentId, children);
    } else {
      roots.push(t);
    }
  }

  return roots.map(r => ({
    todo: r,
    children: parentMap.get(r.id) || [],
  }));
}

function TodoItemRow({ todo, onToggle, onDelete }: { todo: TodoItem; onToggle: (id: string, done: boolean) => void; onDelete: (id: string) => void }) {
  return (
    <div className={styles.todoItem}>
      <button
        className={todo.done ? styles.todoCheckDone : styles.todoCheck}
        onClick={() => onToggle(todo.id, !todo.done)}
        title={todo.done ? 'Mark incomplete' : 'Mark complete'}
      />
      <div className={styles.todoContent}>
        <div className={todo.done ? styles.todoDone : styles.todoTitle}>
          {todo.title}
        </div>
        {todo.due && <div className={styles.todoDue}>{todo.due}</div>}
      </div>
      <button className={styles.todoDeleteBtn} onClick={() => onDelete(todo.id)} title="Delete task">×</button>
    </div>
  );
}

function CollapsibleTodo({ tree, onToggle, onDelete }: { tree: TodoTree; onToggle: (id: string, done: boolean) => void; onDelete: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const hasChildren = tree.children.length > 0;

  return (
    <div>
      <div className={styles.todoParentRow}>
        {hasChildren && (
          <button className={styles.expandBtn} onClick={() => setOpen(!open)}>
            {open ? '▾' : '▸'}
          </button>
        )}
        <div style={{ flex: 1 }}>
          <TodoItemRow todo={tree.todo} onToggle={onToggle} onDelete={onDelete} />
        </div>
      </div>
      {hasChildren && open && (
        <div className={styles.todoChildren}>
          {tree.children.map(child => (
            <TodoItemRow key={child.id} todo={child} onToggle={onToggle} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

const TOGGLEABLE_CALENDARS: { key: string; label: string }[] = [
  { key: TOGGLE_CAL_KEY, label: CALENDARS[TOGGLE_CAL_KEY]?.label || 'Sky Life' },
];

export default function Sidebar({ currentDate, events, todos, notionEntries, todoRange, onTodoRangeChange, onTodoRefresh, onTodoToggle, onTodoDelete, onTodoCreate, onNotionRefresh, hiddenEvents, onToggleHide, taskLinks, onToggleTask, hiddenCalendars, onToggleCalendar }: SidebarProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [notionRefreshing, setNotionRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const handleRefresh = async () => {
    setRefreshing(true);
    try { await onTodoRefresh(); } finally { setRefreshing(false); }
  };
  const handleNotionRefresh = async () => {
    setNotionRefreshing(true);
    try { await onNotionRefresh(); } finally { setNotionRefreshing(false); }
  };
  const handleCreate = async () => {
    if (!newTaskTitle.trim()) return;
    await onTodoCreate(newTaskTitle.trim());
    setNewTaskTitle('');
    setCreating(false);
  };
  const dateStr = currentDate.toISOString().split('T')[0];
  const todayEvents = events
    .filter(e => {
      if (e.calendar === TOGGLE_CAL_KEY) return false;
      const eStart = e.start.split('T')[0];
      const eEnd = e.end.split('T')[0];
      return eStart === dateStr || (eStart <= dateStr && eEnd >= dateStr);
    })
    .sort((a, b) => {
      if (a.allDay && !b.allDay) return -1;
      if (!a.allDay && b.allDay) return 1;
      return new Date(a.start).getTime() - new Date(b.start).getTime();
    });

  const filteredTodos = useMemo(() => {
    // Filter all non-child tasks by date range (parents and standalone alike)
    const filtered = filterTodos(todos, todoRange).filter(t => !t.parentId);
    const filteredIds = new Set(filtered.map(t => t.id));
    // For each parent in the list, pull in ALL its children
    for (const t of todos) {
      if (t.parentId && filteredIds.has(t.parentId) && !filteredIds.has(t.id)) {
        filtered.push(t);
        filteredIds.add(t.id);
      }
    }
    return filtered.sort((a, b) => {
      if (!a.due && !b.due) return 0;
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due.localeCompare(b.due);
    });
  }, [todos, todoRange]);
  const todoTree = useMemo(() => buildTodoTree(filteredTodos), [filteredTodos]);

  return (
    <aside className={styles.sidebar}>
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Today</h2>
        {todayEvents.length === 0 ? (
          <p className={styles.emptyNote}>No events today.</p>
        ) : (
          todayEvents.map(event => {
            const meta = CALENDAR_META[event.calendar];
            const calMeta = CALENDARS[event.calendar as CalendarSource];
            const isHidden = hiddenEvents?.has(event.id);
            const isLinked = taskLinks?.has(event.id);
            return (
              <div key={event.id} className={styles.agendaItem} style={isHidden ? { opacity: 0.35 } : undefined}>
                {isLinked ? (
                  <button
                    className={isHidden ? styles.todoCheckDone : styles.todoCheck}
                    onClick={() => onToggleTask?.(event.id, !isHidden)}
                  />
                ) : (
                  <div className={styles.agendaBar} style={{ backgroundColor: meta.color }} />
                )}
                <div className={styles.agendaContent}>
                  <div className={isLinked && isHidden ? styles.todoDone : styles.agendaTitle} style={isLinked && isHidden ? { fontFamily: 'var(--font-body)', fontSize: '0.82rem' } : undefined}>{event.title}</div>
                  <div className={styles.agendaTime}>
                    {event.allDay ? 'All day' : `${formatTime(event.start)} \u2013 ${formatTime(event.end)}`}
                  </div>
                  {event.location && (
                    /^https?:\/\//.test(event.location)
                      ? <a href={event.location} target="_blank" rel="noopener noreferrer" className={styles.agendaLink}>{getConferenceLabel(event.location)}</a>
                      : <div className={styles.agendaLocation}>{event.location}</div>
                  )}
                  {!event.location && event.conferenceUrl && (
                    <a href={event.conferenceUrl} target="_blank" rel="noopener noreferrer" className={styles.agendaLink}>{getConferenceLabel(event.conferenceUrl)}</a>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Notion</h2>
          <button className={notionRefreshing ? styles.refreshBtnSpin : styles.refreshBtn} onClick={handleNotionRefresh} title="Refresh Notion" disabled={notionRefreshing}>↻</button>
        </div>
        {notionEntries.length === 0 ? (
          <p className={styles.emptyNote}>No entries.</p>
        ) : (
          notionEntries.map(entry => (
            <div key={entry.id} className={styles.notionItem}>
              <div className={styles.notionTitle}>{entry.title}</div>
              <div className={styles.notionMeta}>
                {entry.status}
                {entry.deadline && ` \u00B7 ${entry.deadline}`}
                {` \u00B7 ${entry.database}`}
              </div>
            </div>
          ))
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Tasks</h2>
          <div className={styles.rangeTabs}>
            {(['today', 'tomorrow', 'week', 'month'] as TodoRange[]).map(r => (
              <button
                key={r}
                className={todoRange === r ? styles.rangeTabActive : styles.rangeTab}
                onClick={() => onTodoRangeChange(r)}
              >
                {RANGE_LABELS[r]}
              </button>
            ))}
          </div>
          <button className={refreshing ? styles.refreshBtnSpin : styles.refreshBtn} onClick={handleRefresh} title="Refresh tasks" disabled={refreshing}>↻</button>
          <button className={styles.addBtn} onClick={() => setCreating(!creating)} title="New task">{creating ? '−' : '+'}</button>
        </div>
        {creating && (
          <form className={styles.createForm} onSubmit={e => { e.preventDefault(); handleCreate(); }}>
            <input
              className={styles.createInput}
              value={newTaskTitle}
              onChange={e => setNewTaskTitle(e.target.value)}
              placeholder="New task..."
              autoFocus
            />
            <button className={styles.createSubmit} type="submit">↵</button>
          </form>
        )}
        {todoTree.length === 0 ? (
          <p className={styles.emptyNote}>No tasks.</p>
        ) : (
          todoTree.map(tree => (
            <CollapsibleTodo key={tree.todo.id} tree={tree} onToggle={onTodoToggle} onDelete={onTodoDelete} />
          ))
        )}
      </div>

    </aside>
  );
}
