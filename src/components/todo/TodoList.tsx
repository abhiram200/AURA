import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
  type CollisionDetection,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { AnimatePresence } from 'framer-motion';
import { useTodoStore } from '../../store/todoStore';
import { TodoItem } from './TodoItem';
import { EmptyState } from './EmptyState';
import { CreateGroupModal } from './CreateGroupModal';
import { GroupCard } from './GroupCard';
import { getFilteredTodos, sortByOrder, sortByPriority, sortByPriorityAsc, sortWithCompletedLast } from '../../utils/todoHelpers';
import type { Priority } from '../../types/todo';

/**
 * Custom collision detection: prioritize sortable items over group droppables.
 * Only falls back to a group droppable when the pointer is inside the group
 * but NOT close to any sortable task item. This ensures drag-to-reorder
 * works correctly inside groups, while dropping on empty group space or
 * the header still targets the group.
 */
function customCollisionDetection(args: Parameters<CollisionDetection>[0]): ReturnType<CollisionDetection> {
  // First, check if there are any sortable collisions nearby
  const sortableCollisions = closestCenter(args);

  // If the closest collision is a sortable item (not a group), prefer it
  if (sortableCollisions.length > 0) {
    const closestId = sortableCollisions[0].id;
    const closestDroppable = args.droppableContainers.find(
      (d) => String(d.id) === String(closestId)
    );
    const closestData = closestDroppable?.data?.current;
    if (closestData?.type !== 'group') {
      return sortableCollisions;
    }
  }

  // If no sortable item is close, or the closest is a group, check if
  // pointer is inside any group droppable for group assignment
  const pointerCoords = args.pointerCoordinates;
  if (pointerCoords) {
    for (const droppable of args.droppableContainers) {
      const data = droppable.data.current;
      if (data?.type === 'group') {
        const rect = args.droppableRects.get(droppable.id);
        if (rect) {
          if (
            pointerCoords.x >= rect.left &&
            pointerCoords.x <= rect.right &&
            pointerCoords.y >= rect.top &&
            pointerCoords.y <= rect.bottom
          ) {
            return [{ id: droppable.id }];
          }
        }
      }
    }
  }

  return sortableCollisions;
}

/** Insertion indicator: which item to show an insertion line above/below */
interface InsertIndicator {
  /** The id of the item near which the insertion line appears */
  targetId: string;
  /** 'above' = insert before, 'below' = insert after */
  position: 'above' | 'below';
}

export function TodoList() {
  const todos = useTodoStore((s) => s.todos);
  const groups = useTodoStore((s) => s.groups);
  const filters = useTodoStore((s) => s.filters);
  const reorderTodos = useTodoStore((s) => s.reorderTodos);
  const assignTodosToGroup = useTodoStore((s) => s.assignTodosToGroup);
  const selectedIds = useTodoStore((s) => s.selectedIds);
  const groupSortOrders = useTodoStore((s) => s.groupSortOrders);
  const groupFilterPriority = useTodoStore((s) => s.groupFilterPriority);

  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupTodoIds, setGroupTodoIds] = useState<string[]>([]);
  const [groupingTargetId, setGroupingTargetId] = useState<string | null>(null);
  const [activeTodoId, setActiveTodoId] = useState<string | null>(null);
  const [insertIndicator, setInsertIndicator] = useState<InsertIndicator | null>(null);

  // Track pointer position globally during drag for grouping detection
  const pointerPosRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);

  // Listen for pointer movement during drag
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (isDraggingRef.current) {
        pointerPosRef.current = { x: e.clientX, y: e.clientY };
      }
    };
    window.addEventListener('pointermove', handlePointerMove);
    return () => window.removeEventListener('pointermove', handlePointerMove);
  }, []);

  const filteredTodos = sortByOrder(getFilteredTodos(todos, filters));
  const showCheckbox = selectedIds.length > 0;

  // Partition tasks into ungrouped and grouped, applying sort & filter per group
  const { ungroupedTasks, groupedSections } = useMemo(() => {
    const ungroupedTasks = filteredTodos.filter((t) => !t.groupId);
    const groupMap = new Map<string, typeof filteredTodos>();
    for (const todo of filteredTodos) {
      if (todo.groupId) {
        const existing = groupMap.get(todo.groupId) || [];
        existing.push(todo);
        groupMap.set(todo.groupId, existing);
      }
    }
    // Preserve group order from store, then apply per-group sort & filter
    const groupedSections = groups
      .filter((g) => groupMap.has(g.id))
      .map((g) => {
        let tasks = groupMap.get(g.id)!;
        // Apply priority filter
        const filterPriority = groupFilterPriority[g.id] as Priority | null | undefined;
        if (filterPriority) {
          tasks = tasks.filter((t) => t.priority === filterPriority);
        }
        // Apply sort order
        const sortOrder = groupSortOrders[g.id] || 'manual';
        if (sortOrder === 'priority') {
          tasks = sortByPriority(tasks);
        } else if (sortOrder === 'priority-asc') {
          tasks = sortByPriorityAsc(tasks);
        } else if (sortOrder === 'completed-last') {
          tasks = sortWithCompletedLast(tasks);
        }
        return { group: g, tasks };
      });
    return { ungroupedTasks, groupedSections };
  }, [filteredTodos, groups, groupSortOrders, groupFilterPriority]);

  // Helper: look up a todo by id
  const getTodoById = useCallback(
    (id: string) => todos.find((t) => t.id === id),
    [todos],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    isDraggingRef.current = true;
    pointerPosRef.current = null;
    setActiveTodoId(event.active.id as string);
    setInsertIndicator(null);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event;
    if (!over || !pointerPosRef.current) {
      setGroupingTargetId(null);
      setInsertIndicator(null);
      return;
    }

    // Check if hovering over a group card (droppable)
    const overData = over.data.current;
    if (overData?.type === 'group') {
      // Don't highlight as grouping target when over a group card
      setGroupingTargetId(null);
      setInsertIndicator(null);
      return;
    }

    const overElement = document.querySelector(`[data-todo-id="${over.id}"]`);
    if (overElement) {
      const rect = overElement.getBoundingClientRect();
      const { y: pointerY } = pointerPosRef.current;
      const centerTop = rect.top + rect.height * 0.30;
      const centerBottom = rect.bottom - rect.height * 0.30;

      if (pointerY > centerTop && pointerY < centerBottom) {
        // Center zone — grouping intent
        setGroupingTargetId(over.id as string);
        setInsertIndicator(null);
      } else {
        // Top or bottom zone — reorder intent, show insertion indicator
        setGroupingTargetId(null);
        if (pointerY <= centerTop) {
          setInsertIndicator({ targetId: over.id as string, position: 'above' });
        } else {
          setInsertIndicator({ targetId: over.id as string, position: 'below' });
        }
      }
    } else {
      setGroupingTargetId(null);
      setInsertIndicator(null);
    }
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      isDraggingRef.current = false;

      // Save insert indicator before clearing state
      const savedIndicator = insertIndicator;

      setGroupingTargetId(null);
      setActiveTodoId(null);
      setInsertIndicator(null);

      const { active, over } = event;

      if (!over || active.id === over.id) {
        pointerPosRef.current = null;
        return;
      }

      const activeId = active.id as string;
      const overData = over.data.current;

      // Check if dropped on a GroupCard (droppable with type 'group')
      // BUT: if we have an insertIndicator targeting a specific task, that means
      // the user was reordering near a task inside the group — do reorder instead
      if (overData?.type === 'group') {
        if (savedIndicator && savedIndicator.targetId) {
          // User was dragging near a task (top/bottom zone) inside the group — reorder
          const insertPosition = savedIndicator.position === 'below' ? 'after' : 'before';
          reorderTodos(activeId, savedIndicator.targetId, insertPosition);
          pointerPosRef.current = null;
          return;
        }
        // Dropped on group header/empty area — assign to group
        const targetGroupId = overData.groupId as string;
        assignTodosToGroup([activeId], targetGroupId);
        pointerPosRef.current = null;
        return;
      }

      const overId = over.id as string;

      // Look up whether the active and over tasks are in groups
      const activeTodo = getTodoById(activeId);
      const overTodo = getTodoById(overId);

      // Determine insert position: 'before' or 'after' based on saved indicator
      const insertPosition = savedIndicator?.position === 'below' ? 'after' : 'before';

      // Check if pointer dropped in the center zone of the over item → grouping intent
      const overElement = document.querySelector(`[data-todo-id="${overId}"]`);
      if (overElement && pointerPosRef.current) {
        const rect = overElement.getBoundingClientRect();
        const { y: pointerY } = pointerPosRef.current;
        const centerTop = rect.top + rect.height * 0.30;
        const centerBottom = rect.bottom - rect.height * 0.30;

        if (pointerY > centerTop && pointerY < centerBottom) {
          // Center zone drop — grouping intent

          // If the active task is already in a group, prevent nested grouping.
          // Instead, assign it to the target's group (if target has one), or just reorder.
          if (activeTodo?.groupId) {
            if (overTodo?.groupId && overTodo.groupId !== activeTodo.groupId) {
              // Both in different groups → move active to over's group
              assignTodosToGroup([activeId], overTodo.groupId);
            }
            // Same group or over is ungrouped → just reorder (no new group)
            pointerPosRef.current = null;
            reorderTodos(activeId, overId, insertPosition);
            return;
          }

          // Active is ungrouped. If over is in a group, assign active to that group.
          if (overTodo?.groupId) {
            assignTodosToGroup([activeId], overTodo.groupId);
            pointerPosRef.current = null;
            return;
          }

          // Both ungrouped → open create group modal
          setGroupTodoIds([activeId, overId]);
          setGroupModalOpen(true);
          pointerPosRef.current = null;
          return;
        }
      }

      // Default: reorder with insert position
      pointerPosRef.current = null;
      reorderTodos(activeId, overId, insertPosition);
    },
    [reorderTodos, assignTodosToGroup, getTodoById, insertIndicator],
  );

  const handleDragCancel = useCallback(() => {
    isDraggingRef.current = false;
    pointerPosRef.current = null;
    setGroupingTargetId(null);
    setActiveTodoId(null);
    setInsertIndicator(null);
  }, []);

  if (filteredTodos.length === 0) {
    return <EmptyState filterStatus={filters.status} hasSearch={!!filters.search} />;
  }

  // Build the list of sections to render: ungrouped items first, then each group card
  type SectionItem =
    | { kind: 'ungrouped'; todo: typeof filteredTodos[number] }
    | { kind: 'group'; group: typeof groups[number]; tasks: typeof filteredTodos };

  const sections: SectionItem[] = [];

  for (const todo of ungroupedTasks) {
    sections.push({ kind: 'ungrouped', todo });
  }
  for (const { group, tasks } of groupedSections) {
    sections.push({ kind: 'group', group, tasks });
  }

  const activeTodo = activeTodoId ? filteredTodos.find((t) => t.id === activeTodoId) : null;

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={customCollisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext items={filteredTodos.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-3">
            <AnimatePresence mode="popLayout">
              {sections.map((section) => {
                if (section.kind === 'ungrouped') {
                  return (
                    <TodoItem
                      key={section.todo.id}
                      todo={section.todo}
                      showCheckbox={showCheckbox}
                      isGroupingTarget={groupingTargetId === section.todo.id}
                      insertAbove={insertIndicator?.targetId === section.todo.id && insertIndicator.position === 'above'}
                      insertBelow={insertIndicator?.targetId === section.todo.id && insertIndicator.position === 'below'}
                    />
                  );
                }

                const { group, tasks } = section;
                return (
                  <GroupCard key={`group-${group.id}`} group={group}>
                    {tasks.map((todo) => (
                      <TodoItem
                        key={todo.id}
                        todo={todo}
                        showCheckbox={showCheckbox}
                        isGroupingTarget={groupingTargetId === todo.id}
                        hideGroupBadge
                        insertAbove={insertIndicator?.targetId === todo.id && insertIndicator.position === 'above'}
                        insertBelow={insertIndicator?.targetId === todo.id && insertIndicator.position === 'below'}
                      />
                    ))}
                  </GroupCard>
                );
              })}
            </AnimatePresence>
          </div>
        </SortableContext>
        <DragOverlay dropAnimation={null}>
          {activeTodo ? (
            <TodoItem
              todo={activeTodo}
              showCheckbox={showCheckbox}
              isDragOverlayItem
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <CreateGroupModal
        isOpen={groupModalOpen}
        onClose={() => setGroupModalOpen(false)}
        todoIds={groupTodoIds}
      />
    </>
  );
}