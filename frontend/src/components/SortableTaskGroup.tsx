// SortableTaskGroup — container de drag-and-drop (`@dnd-kit`) para um único
// grupo (Task_Nova ou Task_Com_Acordo) da Lista_de_Acordos (design.md >
// ListaDeAcordosPage; Requisito 14 — reordenação manual).
//
// Cada grupo tem seu próprio `DndContext`/`SortableContext`, propositalmente
// isolado dos demais grupos: a reordenação por drag-and-drop só precisa
// funcionar dentro de cada grupo (mover uma Task_Nova entre outras
// Task_Nova, ou uma Task_Com_Acordo entre outras Task_Com_Acordo) — a
// reclassificação Task_Nova → Task_Com_Acordo só ocorre ao registrar um
// Acordo, nunca por drag-and-drop entre grupos.
//
// Este componente não decide "o que fazer" com o resultado do drop: ele
// apenas detecta que a posição de um item mudou dentro da lista (via
// `onDragEnd` do `DndContext`) e delega ao callback `onReorder`, informando
// os índices antigo/novo e o id do item movido. Cabe ao chamador
// (`ListaDeAcordosPage`) atualizar o estado local de forma otimista e
// chamar `reordenarTask` (Requisito 14.1, 14.2).

import type { ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';

export interface SortableTaskGroupProps<T extends { id: string }> {
  items: T[];
  /** Chamado quando o drop resulta em uma posição diferente da original. */
  onReorder: (oldIndex: number, newIndex: number, movedId: string) => void;
  renderItem: (item: T) => ReactNode;
  emptyMessage: ReactNode;
}

export function SortableTaskGroup<T extends { id: string }>({
  items,
  onReorder,
  renderItem,
  emptyMessage,
}: SortableTaskGroupProps<T>) {
  // `activationConstraint` com distância mínima evita que o dnd-kit ative o
  // drag (e suprima o evento de click subsequente) em um simples clique sem
  // movimento — sem isso, os botões de ação do `TaskCard` (Editar, Registrar
  // Acordo, Remover, Ver histórico, Avaliar) ficam inoperantes, pois o
  // `PointerSensor` intercepta o click assim que qualquer `pointerdown`
  // ocorre dentro do item arrastável.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = items.findIndex((item) => item.id === active.id);
    const newIndex = items.findIndex((item) => item.id === over.id);
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
      return;
    }

    onReorder(oldIndex, newIndex, String(active.id));
  }

  if (items.length === 0) {
    return <>{emptyMessage}</>;
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        {items.map((item) => renderItem(item))}
      </SortableContext>
    </DndContext>
  );
}

export default SortableTaskGroup;
