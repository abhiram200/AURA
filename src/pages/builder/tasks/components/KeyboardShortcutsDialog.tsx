import {
  CheckSquare,
  Square,
  GripVertical,
  Filter,
  FolderOpen,
  SunMoon,
  Keyboard,
  Lightbulb,
} from 'lucide-react';
import { Modal } from './ui/Modal';

interface KeyboardShortcutsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 text-[11px] font-mono font-medium text-text-secondary bg-surface-raised border border-border rounded shadow-sm">
      {children}
    </kbd>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">{title}</h3>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ShortcutRow({ description, keys }: { description: string; keys: (string | string[])[] }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-sm text-text">{description}</span>
      <div className="flex items-center gap-0.5">
        {keys.map((key, i) => {
          if (Array.isArray(key)) {
            return (
              <span key={i} className="flex items-center gap-0.5">
                {key.map((k, j) => (
                  <span key={j} className="flex items-center gap-0.5">
                    {j > 0 && <span className="text-text-tertiary text-[10px]">+</span>}
                    <Key>{k}</Key>
                  </span>
                ))}
                {i < keys.length - 1 && <span className="text-text-tertiary text-[10px] mx-0.5">/</span>}
              </span>
            );
          }
          return (
            <span key={i} className="flex items-center gap-0.5">
              <Key>{key}</Key>
              {i < keys.length - 1 && <span className="text-text-tertiary text-[10px] mx-0.5">+</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function TipRow({ description }: { description: string }) {
  return (
    <div className="flex items-start gap-2 py-0.5">
      <span className="text-primary mt-0.5">•</span>
      <span className="text-sm text-text">{description}</span>
    </div>
  );
}

const KEYBOARD_SHORTCUTS: { description: string; keys: (string | string[])[] }[] = [
  { description: 'Create a new todo', keys: ['N'] },
  { description: 'Focus the search bar', keys: ['/', ['⌘', 'K']] },
  { description: 'Clear selection / Cancel editing / Close dialog', keys: ['Esc'] },
  { description: 'Open this shortcuts dialog', keys: ['?'] },
];

const SELECTION_SHORTCUTS: { description: string; keys: (string | string[])[] }[] = [
  { description: 'Select all visible todos', keys: [['⌘', 'A']] },
  { description: 'Delete selected todos', keys: [['⌘', '⌫']] },
  { description: 'Toggle completion for selected todos', keys: [['⌘', 'D']] },
];

export function KeyboardShortcutsDialog({ isOpen, onClose }: KeyboardShortcutsDialogProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Usage Guide & Shortcuts">
      <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
        {/* Keyboard Shortcuts */}
        <Section title="Keyboard Shortcuts" icon={Keyboard}>
          {KEYBOARD_SHORTCUTS.map((item) => (
            <ShortcutRow key={item.description} description={item.description} keys={item.keys} />
          ))}
        </Section>

        {/* Selection Shortcuts */}
        <Section title="Selection Shortcuts" icon={CheckSquare}>
          {SELECTION_SHORTCUTS.map((item) => (
            <ShortcutRow key={item.description} description={item.description} keys={item.keys} />
          ))}
          <TipRow description="Click the checkbox on the left of any todo to select it for bulk actions" />
        </Section>

        {/* Creating & Editing Todos */}
        <Section title="Creating & Editing Todos" icon={Square}>
          <TipRow description="Type in the input field and press Enter or click Add to create a todo" />
          <TipRow description="Click the category, priority, or group icons to set defaults for new todos" />
          <TipRow description="Set a due date using the calendar picker — it remembers your last choices" />
          <TipRow description="Double-click on a todo's text to edit it" />
          <TipRow description="Press Enter to save changes, or Escape to cancel editing" />
          <TipRow description="Click the round checkbox to mark a todo as completed" />
          <TipRow description="Click the priority badge to cycle through Low → Medium → High" />
          <TipRow description="Hover over a todo to see its due date, category, and group badges" />
        </Section>

        {/* Drag & Drop */}
        <Section title="Drag & Drop" icon={GripVertical}>
          <TipRow description="Drag the grip handle (⠿) on the left of a todo to reorder it" />
          <TipRow description="Drop a todo near the top or bottom of another todo to insert it at that position" />
          <TipRow description="Drop a todo onto the center of another todo to group them together" />
          <TipRow description="Drag an ungrouped todo into a group card to assign it to that group" />
          <TipRow description="Drag a todo out of a group and drop it in the ungrouped area to remove it from the group" />
        </Section>

        {/* Filtering & Search */}
        <Section title="Filtering & Search" icon={Filter}>
          <TipRow description="Use the search bar to filter todos by text — results update as you type" />
          <TipRow description="Click the status filters in the sidebar: All, Active, or Completed" />
          <TipRow description="Click a category in the sidebar to show only todos in that category" />
          <TipRow description="Click a priority level in the sidebar to filter by priority" />
          <TipRow description="Click a group in the sidebar to show only todos in that group" />
          <TipRow description="Click the same filter again to deselect it and show all items" />
          <TipRow description="Use the Reset Filters link at the bottom of the sidebar to clear all filters" />
        </Section>

        {/* Groups */}
        <Section title="Groups" icon={FolderOpen}>
          <TipRow description="Use the Groups section in the sidebar or the Manage Groups button to create new groups" />
          <TipRow description="Each group has a custom name, color, and icon" />
          <TipRow description="Click the sort button on a group header to cycle: Manual → Priority → Priority (Asc) → Completed Last" />
          <TipRow description="Click the priority dots on a group header to filter by priority within that group" />
          <TipRow description="Use bulk actions to assign selected todos to a group" />
          <TipRow description="Drag todos between groups or into the ungrouped section to reorganize" />
        </Section>

        {/* Bulk Actions */}
        <Section title="Bulk Actions" icon={CheckSquare}>
          <TipRow description="Select one or more todos using the checkboxes on the left" />
          <TipRow description="A toolbar appears at the bottom when items are selected" />
          <TipRow description="Toggle all selected todos as complete/incomplete, change their category, priority, or group" />
          <TipRow description="Delete all selected todos at once" />
          <TipRow description="Use the Select All checkbox to select or deselect all visible todos" />
        </Section>

        {/* Appearance */}
        <Section title="Appearance" icon={SunMoon}>
          <TipRow description="Click the sun/moon icon in the top bar to toggle between light and dark mode" />
          <TipRow description="Your theme preference is saved automatically" />
          <TipRow description="Long todo text is truncated — click to expand and read the full text" />
        </Section>

        {/* Tips */}
        <Section title="Tips & Tricks" icon={Lightbulb}>
          <TipRow description="All your data is saved locally — no account needed, everything stays in your browser" />
          <TipRow description="The form remembers your last-used category, priority, and group for faster entry" />
          <TipRow description="Use Clear Completed at the bottom to remove all finished todos at once" />
          <TipRow description="Press Escape anywhere to dismiss dialogs, cancel editing, or clear your selection" />
        </Section>
      </div>
    </Modal>
  );
}