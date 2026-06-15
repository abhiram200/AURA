import { X, Inbox, Circle, CheckCircle2, Flag, Tag, Settings2 } from 'lucide-react';
import { useTodoStore } from '../store/todoStore';
import { PRIORITY_CONFIG, ALL_PRIORITIES } from '../utils/constants';
import { Tooltip } from './ui/Tooltip';
import { cn, getIconComponent } from '../utils/helpers';
import type { FilterStatus } from '../types';

interface SidebarProps {
  onClose?: () => void;
  onManageGroups?: () => void;
}

const STATUS_ITEMS: { value: FilterStatus; label: string; icon: React.ReactNode }[] = [
  { value: 'all', label: 'All Tasks', icon: <Inbox className="h-4 w-4" /> },
  { value: 'active', label: 'Active', icon: <Circle className="h-4 w-4" /> },
  { value: 'completed', label: 'Completed', icon: <CheckCircle2 className="h-4 w-4" /> },
];

export function Sidebar({ onClose, onManageGroups }: SidebarProps) {
  const filters = useTodoStore((s) => s.filters);
  const setFilters = useTodoStore((s) => s.setFilters);
  const resetFilters = useTodoStore((s) => s.resetFilters);
  const todos = useTodoStore((s) => s.todos);
  const groups = useTodoStore((s) => s.groups);

  const activeCount = todos.filter((t) => !t.completed).length;
  const completedCount = todos.filter((t) => t.completed).length;
  const totalCount = todos.length;

  const hasActiveFilters = filters.priority !== 'all' || filters.groupId !== 'all';

  return (
    <div className="flex flex-col h-full bg-surface-hover border-r border-border">
      {/* Mobile close button */}
      {onClose && (
        <div className="flex justify-end px-4 pt-3 lg:hidden">
          <Tooltip content="Close menu" side="right">
            <button
              onClick={onClose}
              className="cursor-pointer p-2 rounded-xl text-text-tertiary hover:bg-surface hover:text-text transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </Tooltip>
        </div>
      )}

      {/* Scrollable filter area */}
      <div className="flex-1 overflow-y-auto min-h-0 pt-4">
      {/* Status Filters */}
      <div className="px-4 mb-2">
        <div className="text-[10px] font-bold text-text-tertiary uppercase tracking-[0.12em] px-1 mb-2">
          Status
        </div>
        <div className="space-y-1">
          {STATUS_ITEMS.map((item) => {
            const count =
              item.value === 'all' ? totalCount
                : item.value === 'active' ? activeCount
                  : completedCount;
            const isActive = filters.status === item.value;
            return (
              <button
                key={item.value}
                onClick={() => setFilters({ status: item.value })}
                className={cn(
                  'cursor-pointer w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
                  isActive
                    ? 'bg-primary/15 text-primary shadow-sm'
                    : 'text-text-secondary hover:bg-surface hover:text-text',
                )}
              >
                <span className={cn(
                  'flex items-center justify-center h-7 w-7 rounded-lg transition-colors duration-200',
                  isActive ? 'bg-primary/20 text-primary' : 'bg-surface text-text-tertiary',
                )}>
                  {item.icon}
                </span>
                <span className="flex-1 text-left">{item.label}</span>
                <span className={cn(
                  'text-xs tabular-nums font-semibold px-2 py-0.5 rounded-md transition-colors duration-200',
                  isActive ? 'bg-primary/20 text-primary' : 'bg-surface text-text-tertiary',
                )}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Divider */}
      <div className="mx-6 my-3 border-t border-border" />

      {/* Groups */}
      <div className="px-4 mb-2">
        <div className="flex items-center justify-between px-1 mb-2">
          <div className="text-[10px] font-bold text-text-tertiary uppercase tracking-[0.12em]">
            Groups
          </div>
          {onManageGroups && (
            <Tooltip content="Manage groups" side="right">
              <button
                onClick={onManageGroups}
                className="p-1 rounded-md text-text-tertiary hover:text-primary hover:bg-surface transition-colors"
              >
                <Settings2 className="h-3 w-3" />
              </button>
            </Tooltip>
          )}
        </div>
        <div className="space-y-1">
          {/* "All" group button */}
          <button
            onClick={() => setFilters({ groupId: 'all' })}
            className={cn(
              'cursor-pointer w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
              filters.groupId === 'all'
                ? 'bg-primary/15 text-primary shadow-sm'
                : 'text-text-secondary hover:bg-surface hover:text-text',
            )}
          >
            <span className={cn(
              'flex items-center justify-center h-7 w-7 rounded-lg transition-colors duration-200',
              filters.groupId === 'all' ? 'bg-primary/20 text-primary' : 'bg-surface text-text-tertiary',
            )}>
              <Inbox className="h-3.5 w-3.5" />
            </span>
            <span className="flex-1 text-left">All Groups</span>
            <span className={cn(
              'text-xs tabular-nums font-semibold px-2 py-0.5 rounded-md transition-colors duration-200',
              filters.groupId === 'all' ? 'bg-primary/20 text-primary' : 'bg-surface text-text-tertiary',
            )}>
              {totalCount}
            </span>
          </button>

          {/* Ungrouped button */}
          {(() => {
            const isUngrouped = filters.groupId === 'ungrouped';
            const ungroupedCount = todos.filter((t) => !t.groupId).length;
            return (
              <button
                onClick={() => setFilters({ groupId: isUngrouped ? 'all' : 'ungrouped' })}
                className={cn(
                  'cursor-pointer group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
                  isUngrouped
                    ? 'bg-primary/15 text-primary shadow-sm'
                    : 'text-text-secondary hover:bg-surface hover:text-text',
                )}
              >
                <span className={cn(
                  'flex items-center justify-center h-7 w-7 rounded-lg transition-colors duration-200',
                  isUngrouped ? 'bg-primary/20 text-primary' : 'bg-surface group-hover:bg-surface-raised text-text-tertiary',
                )}>
                  <Tag className="h-3.5 w-3.5" />
                </span>
                <span className="flex-1 text-left">Ungrouped</span>
                <span className={cn(
                  'text-xs tabular-nums font-semibold px-2 py-0.5 rounded-md transition-colors duration-200',
                  isUngrouped ? 'bg-primary/20 text-primary' : 'bg-surface text-text-tertiary',
                )}>
                  {ungroupedCount}
                </span>
              </button>
            );
          })()}

          {/* Group items */}
          {groups.map((group) => {
            const isActive = filters.groupId === group.id;
            const groupCount = todos.filter((t) => t.groupId === group.id).length;
            const Icon = getIconComponent(group.icon);
            return (
              <button
                key={group.id}
                onClick={() => setFilters({ groupId: isActive ? 'all' : group.id })}
                className={cn(
                  'cursor-pointer group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
                  isActive
                    ? 'shadow-sm'
                    : 'text-text-secondary hover:bg-surface hover:text-text',
                )}
                style={isActive ? { backgroundColor: `${group.color}18` } : undefined}
              >
                <span
                  className={cn(
                    'flex items-center justify-center h-7 w-7 rounded-lg transition-colors duration-200',
                    isActive ? '' : 'bg-surface group-hover:bg-surface-raised',
                  )}
                  style={isActive ? { backgroundColor: `${group.color}30`, color: group.color } : { color: group.color }}
                >
                  {Icon ? <Icon className="h-3.5 w-3.5" /> : <Inbox className="h-3.5 w-3.5" />}
                </span>
                <span
                  className="flex-1 text-left"
                  style={isActive ? { color: group.color } : undefined}
                >
                  {group.name}
                </span>
                <span
                  className="text-xs tabular-nums font-semibold px-2 py-0.5 rounded-md transition-colors duration-200"
                  style={isActive
                    ? { backgroundColor: `${group.color}25`, color: group.color }
                    : undefined}
                >
                  <span className={isActive ? undefined : 'bg-surface text-text-tertiary px-2 py-0.5 rounded-md'}>
                    {groupCount}
                  </span>
                </span>
              </button>
            );
          })}

        </div>
      </div>

      {/* Divider */}
      <div className="mx-6 my-3 border-t border-border" />

      {/* Priority Filters */}
      <div className="px-4 mb-2">
        <div className="text-[10px] font-bold text-text-tertiary uppercase tracking-[0.12em] px-1 mb-2">
          Priority
        </div>
        <div className="space-y-1">
          {/* "All" priority button */}
          <button
            onClick={() => setFilters({ priority: 'all' })}
            className={cn(
              'cursor-pointer w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
              filters.priority === 'all'
                ? 'bg-primary/15 text-primary shadow-sm'
                : 'text-text-secondary hover:bg-surface hover:text-text',
            )}
          >
            <span className={cn(
              'flex items-center justify-center h-7 w-7 rounded-lg transition-colors duration-200',
              filters.priority === 'all' ? 'bg-primary/20 text-primary' : 'bg-surface text-text-tertiary',
            )}>
              <Flag className="h-3.5 w-3.5" />
            </span>
            <span className="flex-1 text-left">All Priorities</span>
            <span className={cn(
              'text-xs tabular-nums font-semibold px-2 py-0.5 rounded-md transition-colors duration-200',
              filters.priority === 'all' ? 'bg-primary/20 text-primary' : 'bg-surface text-text-tertiary',
            )}>
              {totalCount}
            </span>
          </button>

          {ALL_PRIORITIES.map((p) => {
            const config = PRIORITY_CONFIG[p];
            const isThisActive = filters.priority === p;
            const priCount = todos.filter((t) => t.priority === p).length;
            return (
              <button
                key={p}
                onClick={() => setFilters({ priority: isThisActive ? 'all' : p })}
                className={cn(
                  'cursor-pointer group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
                  isThisActive
                    ? 'shadow-sm'
                    : 'text-text-secondary hover:bg-surface hover:text-text',
                )}
                style={isThisActive ? { backgroundColor: `${config.color}18` } : undefined}
              >
                {/* Colored flag icon container */}
                <span
                  className={cn(
                    'flex items-center justify-center h-7 w-7 rounded-lg transition-colors duration-200',
                    isThisActive ? '' : 'bg-surface group-hover:bg-surface-raised',
                  )}
                  style={isThisActive ? { backgroundColor: `${config.color}30`, color: config.color } : undefined}
                >
                  <Flag className="h-3.5 w-3.5" style={!isThisActive ? { color: config.color } : undefined} />
                </span>
                <span
                  className="flex-1 text-left"
                  style={isThisActive ? { color: config.color } : undefined}
                >
                  {config.label}
                </span>
                <span
                  className={cn(
                    'text-xs tabular-nums font-semibold px-2 py-0.5 rounded-md transition-colors duration-200',
                  )}
                  style={isThisActive
                    ? { backgroundColor: `${config.color}25`, color: config.color }
                    : undefined}
                >
                  <span className={isThisActive ? undefined : 'bg-surface text-text-tertiary px-2 py-0.5 rounded-md'}>
                    {priCount}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Reset filters */}
      {hasActiveFilters && (
        <div className="px-5 mt-2">
          <Tooltip content="Clear all active filters" side="right">
            <button
              onClick={resetFilters}
              className="cursor-pointer text-xs font-medium text-text-tertiary hover:text-danger transition-colors px-1"
            >
              ← Reset all filters
            </button>
          </Tooltip>
        </div>
      )}
      </div>{/* End scrollable filter area */}
    </div>
  );
}