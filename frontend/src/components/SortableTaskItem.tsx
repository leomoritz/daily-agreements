// SortableTaskItem — envolve `TaskCard` com `useSortable` (@dnd-kit/sortable),
// tornando cada item de um grupo arrastável dentro do `SortableContext` que o
// envolve (design.md > ListaDeAcordosPage; Requisito 14 — reordenação manual
// via drag-and-drop).
//
// Este componente só é responsável por tornar o item arrastável e aplicar a
// transformação visual durante o arrasto. A decisão de "o que fazer" com o
// resultado do drop (calcular a nova posição, chamar `reordenarTask`, reverter
// em caso de erro) pertence à `ListaDeAcordosPage`, através do `onDragEnd` do
// `DndContext` que envolve este componente.

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TaskComAcordoItem, TaskNovaItem } from '../api/types';
import { TaskCard, type TaskEdicaoResultado } from './TaskCard';

export interface SortableTaskItemProps {
  item: TaskNovaItem | TaskComAcordoItem;
  /** Repassado a `TaskCard` (Requisito 9.1, 9.2, 9.6, 9.7 — tarefa 27.1). */
  onTaskEditada?: (taskId: string, resultado: TaskEdicaoResultado) => void;
  /** Repassado a `TaskCard` (Requisito 9.4, 9.5 — tarefa 27.1). */
  onTaskRemovida?: (taskId: string) => void;
  /** Repassado a `TaskCard` (tarefa 28.1 — wiring final do frontend). */
  onAcordoAlterado?: () => void;
}

export function SortableTaskItem({
  item,
  onTaskEditada,
  onTaskRemovida,
  onAcordoAlterado,
}: SortableTaskItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} data-testid="sortable-task-item">
      <TaskCard
        item={item}
        onTaskEditada={onTaskEditada}
        onTaskRemovida={onTaskRemovida}
        onAcordoAlterado={onAcordoAlterado}
      />
    </div>
  );
}

export default SortableTaskItem;
