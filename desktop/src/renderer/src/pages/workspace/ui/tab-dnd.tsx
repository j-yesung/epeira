// 탭 끌기 (탭 줄 ↔ 칸): 탭에 놓으면 그 자리로 순서를 바꾸고, 칸에 놓으면 그 칸에 보여 준다
// 끄는 동안 탭 모양이 포인터를 따라온다 (탭 줄은 넘치면 잘려서 탭 자체를 칸까지 끌고 갈 수 없다)
import { type ReactNode, useState } from "react";

import { DndContext, DragOverlay, PointerSensor, pointerWithin, useSensor, useSensors } from "@dnd-kit/core";

import { tabLabel } from "@/entities/tab/model/label";
import { useTabs } from "@/entities/tab/model/store";
import { KindIcon } from "@/entities/tab/ui/kind-icon";
import { focusActive } from "@/features/manage-tabs/model/actions";
import { dropTabOnPane } from "@/features/manage-tabs/model/panes";

function DraggedTab({ id }: { id: string }) {
  const tabs = useTabs((s) => s.tabs);
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return null;
  return (
    <div className="flex h-[30px] w-[200px] cursor-grabbing items-center gap-[7px] rounded-lg border border-input bg-secondary px-2 text-foreground shadow-md">
      <KindIcon kind={tab.kind} />
      <span className="truncate">{tabLabel(tab, tabs)}</span>
    </div>
  );
}

export function TabDnd({ children }: { children: ReactNode }) {
  const [dragging, setDragging] = useState<string | null>(null);
  // 조금 움직여야 끌기 시작 → 그냥 누르면 탭 고르기 · 닫기
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(e) => setDragging(String(e.active.id))}
      onDragCancel={() => setDragging(null)}
      onDragEnd={({ active, over }) => {
        setDragging(null);
        if (!over) return;
        const pane = over.data.current?.pane;
        if (typeof pane === "string") return dropTabOnPane(String(active.id), pane);
        useTabs.getState().move(String(active.id), String(over.id));
        focusActive(); // 탭을 누르며 끌었으니 입력 위치를 터미널로 돌려준다
      }}
    >
      {children}
      <DragOverlay dropAnimation={null}>{dragging && <DraggedTab id={dragging} />}</DragOverlay>
    </DndContext>
  );
}
