import { motion } from 'framer-motion';
import { ClipboardList } from 'lucide-react';
import type { FilterStatus } from '../../types/todo';

interface EmptyStateProps {
  filterStatus: FilterStatus;
  hasSearch: boolean;
}

const messages: Record<FilterStatus, { title: string; description: string }> = {
  all: { title: 'No tasks yet', description: 'Add your first task to get started with TaskNova!' },
  active: { title: 'No active tasks', description: 'All your tasks are completed. Nice work!' },
  completed: { title: 'No completed tasks', description: 'Complete some tasks to see them here.' },
};

export function EmptyState({ filterStatus, hasSearch }: EmptyStateProps) {
  const message = hasSearch
    ? { title: 'No results found', description: 'Try adjusting your search or filters.' }
    : messages[filterStatus];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center justify-center py-16 text-center"
    >
      <div className="w-20 h-20 rounded-2xl bg-surface-raised flex items-center justify-center mb-5">
        <ClipboardList className="h-10 w-10 text-text-tertiary" />
      </div>
      <h3 className="text-lg font-semibold text-text mb-2">{message.title}</h3>
      <p className="text-sm text-text-secondary max-w-md">{message.description}</p>
    </motion.div>
  );
}