import { useState, forwardRef, useCallback } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { motion } from 'framer-motion';
import { getIconComponent } from '../../utils/todoHelpers';
import { EditGroupModal } from './EditGroupModal';
import { Tooltip } from './ui/Tooltip';
import { useTodoStore } from '../../store/todoStore';
import { PRIORITY_CONFIG } from '../../utils/todoConstants';
import type { TaskGroup, Priority } from '../../types/todo';
import type { ReactNode } from 'react';

interface GroupCardProps {
  group: TaskGroup;
  children: ReactNode;
}

// SVG icons for sort states
function SortDescIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m3 16 4 4 4-4" />
      <path d="M7 20V4" />
      <path d="m21 8-4-4-4 4" />
      <path d="M17 4v16" />
    </svg>
  );
}

function SortAscIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m3 8 4-4 4 4" />
      <path d="M7 4v16" />
      <path d="m21 16-4 4-4-4" />
      <path d="M17 20V4" />
    </svg>
  );
}

function CompletedLastIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </svg>
  );
}

export const GroupCard = forwardRef<HTMLDivElement, GroupCardProps>(function GroupCard({ group, children }, forwardedRef) {
  const groupSortOrder = useTodoStore((s) => s.groupSortOrders[group.id] || 'manual');
  const toggleGroupSort = useTodoStore((s) => s.toggleGroupSort);
  const activeFilterPriority = useTodoStore((s) => s.groupFilterPriority[group.id] || null);
  const setGroupFilterPriority = useTodoStore((s) => s.setGroupFilterPriority);
  const theme = useTodoStore((s) => s.theme);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const IconComponent = getIconComponent(group.icon);
  const isLight = theme === 'light';

  const isFilterActive = !!activeFilterPriority;

  // Compute priority-based pending/total counts for tasks in this group
  const groupTodos = useTodoStore((s) =>
    s.todos.filter((t) => t.groupId === group.id)
  );
  const priorityBreakdown = (['high', 'medium', 'low'] as Priority[]).map(
    (p) => {
      const total = groupTodos.filter((t) => t.priority === p).length;
      const pending = groupTodos.filter(
        (t) => t.priority === p && !t.completed
      ).length;
      return { priority: p, total, pending };
    }
  );

  // Sort button tooltip and icon logic
  let sortTooltip: string;
  let SortIconComponent: typeof SortDescIcon;

  if (isFilterActive) {
    // 2-state: manual (as-is) ↔ completed-last
    if (groupSortOrder === 'completed-last') {
      sortTooltip = 'Sort: completed last (click for as-is)';
      SortIconComponent = CompletedLastIcon;
    } else {
      sortTooltip = 'Sort: as-is (click for completed last)';
      SortIconComponent = SortDescIcon;
    }
  } else {
    // 4-state: manual → priority → priority-asc → completed-last
    if (groupSortOrder === 'priority') {
      sortTooltip = 'Sort: high→low (click for low→high)';
      SortIconComponent = SortDescIcon;
    } else if (groupSortOrder === 'priority-asc') {
      sortTooltip = 'Sort: low→high (click for completed last)';
      SortIconComponent = SortAscIcon;
    } else if (groupSortOrder === 'completed-last') {
      sortTooltip = 'Sort: completed last (click for manual)';
      SortIconComponent = CompletedLastIcon;
    } else {
      sortTooltip = 'Sort by priority (high→low)';
      SortIconComponent = SortDescIcon;
    }
  }

  const { setNodeRef, isOver } = useDroppable({
    id: `group-${group.id}`,
    data: { type: 'group', groupId: group.id },
  });

  const mergedRef = useCallback((node: HTMLDivElement | null) => {
    setNodeRef(node);
    if (typeof forwardedRef === 'function') {
      forwardedRef(node);
    } else if (forwardedRef) {
      forwardedRef.current = node;
    }
  }, [setNodeRef, forwardedRef]);

  return (
    <motion.div
      ref={mergedRef}
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      data-group-id={group.id}
      className="rounded-xl overflow-hidden"
      style={{
        border: `1px solid ${isOver ? group.color : `${group.color}${isLight ? '50' : '30'}`}`,
        backgroundColor: isOver ? `${group.color}${isLight ? '25' : '15'}` : `${group.color}${isLight ? '12' : '08'}`,
        boxShadow: isOver ? `0 0 0 2px ${group.color}${isLight ? '60' : '40'}` : undefined,
        transition: 'border-color 0.15s, background-color 0.15s, box-shadow 0.15s',
      }}
    >
      {/* Group header */}
      <div
        className="flex items-center gap-2.5 px-4 py-2.5 cursor-default"
        style={{ backgroundColor: `${group.color}${isLight ? '1a' : '12'}` }}
      >
        {/* Icon container */}
        <span
          className="flex items-center justify-center h-7 w-7 rounded-lg"
          style={{ backgroundColor: `${group.color}${isLight ? '30' : '20'}`, color: group.color }}
        >
          {IconComponent ? (
            <IconComponent className="h-3.5 w-3.5" />
          ) : (
            <span className="text-xs font-bold" style={{ color: group.color }}>
              {group.name.charAt(0).toUpperCase()}
            </span>
          )}
        </span>

        {/* Group name */}
        <span
          className="text-sm font-semibold flex-1"
          style={{ color: group.color }}
        >
          {group.name}
        </span>

        {/* Priority breakdown pills */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-medium text-text-tertiary">Pending:</span>
          {priorityBreakdown.map(({ priority, pending, total }) => {
            if (total === 0) return null;
            const config = PRIORITY_CONFIG[priority];
            const allDone = pending === 0;
            const isActive = activeFilterPriority === priority;
            const tooltipText = isActive
              ? `Clear ${config.label.toLowerCase()} priority filter`
              : allDone
                ? `${config.label} priority: all ${total} completed`
                : `${config.label} priority: ${pending} pending, ${total} total`;
            return (
              <Tooltip key={priority} content={tooltipText}>
              <button
                onClick={() => {
                  setGroupFilterPriority(group.id, isActive ? null : priority);
                }}
                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md tabular-nums inline-flex items-center gap-0.5 cursor-pointer transition-all ${
                  activeFilterPriority && !isActive ? 'opacity-40' : 'hover:brightness-110'
                }`}
                style={{
                  color: allDone ? '#16a34a' : config.color,
                  backgroundColor: isActive
                    ? config.color
                    : allDone
                      ? `${config.color}50`
                      : config.bgColor,
                  ...(isActive ? { color: '#fff' } : {}),
                }}
              >
                {allDone ? (
                  <>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    {total}
                  </>
                ) : (
                  `${pending}/${total}`
                )}
              </button>
              </Tooltip>
            );
          })}
        </div>

        {/* Sort button */}
        <Tooltip content={sortTooltip}>
          <button
            onClick={() => toggleGroupSort(group.id, isFilterActive)}
            className={`p-1 rounded-md transition-colors cursor-pointer ${
              groupSortOrder !== 'manual'
                ? 'text-text-primary bg-surface-secondary'
                : 'text-text-tertiary hover:text-text-secondary'
            }`}
          >
            <SortIconComponent />
          </button>
        </Tooltip>

        {/* Edit group button */}
        <Tooltip content="Edit group">
          <button
            onClick={() => setEditModalOpen(true)}
            className="p-1 rounded-md text-text-tertiary hover:text-text-secondary transition-opacity cursor-pointer"
            style={{ color: `${group.color}80` }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              <path d="m15 5 4 4" />
            </svg>
          </button>
        </Tooltip>
      </div>

      {/* Left color bar + task list */}
      <div className="flex">
        {/* Thin colored accent bar on the left */}
        <div
          className="w-1 flex-shrink-0"
          style={{ backgroundColor: `${group.color}${isLight ? '60' : '40'}` }}
        />
        {/* Task items */}
        <div className="flex-1 flex flex-col gap-2 p-3">
          {children}
        </div>
      </div>

      {/* Edit group modal */}
      <EditGroupModal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        group={group}
      />
    </motion.div>
  );
});