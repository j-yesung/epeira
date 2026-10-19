// 놓친 알림: 보고 있지 않을 때 생긴 응답 끝 · 승인 대기 (누르면 그 탭으로). 열면 모두 읽은 것으로
import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useInbox } from "@/entities/notification/model/inbox";
import { activateTab } from "@/features/manage-tabs/model/actions";
import { ago } from "@/shared/lib/time";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

export function InboxButton() {
  const { t } = useTranslation();
  const items = useInbox((s) => s.items);
  const unread = items.filter((x) => !x.read).length;
  const label = unread ? t("statusbar.inboxUnread", { count: unread }) : t("statusbar.inbox");
  return (
    <DropdownMenu onOpenChange={(open) => open && useInbox.getState().readAll()}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={label}
          aria-label={label}
          className="relative grid h-5 w-[22px] cursor-pointer place-items-center rounded-sm hover:bg-secondary hover:text-foreground"
        >
          <Bell className="size-3.5" />
          {unread > 0 && (
            <span className="absolute -top-[3px] -right-1 h-3.5 min-w-3.5 rounded-full bg-primary px-[3px] text-center font-bold font-mono text-[9px] text-primary-foreground leading-3.5">
              {unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end">
        {items.length ? (
          <>
            {items.map((x) => (
              <DropdownMenuItem key={`${x.at}-${x.tab}`} onSelect={() => activateTab(x.tab)}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{x.title}</span>
                  <small className="truncate text-faint-foreground text-xs">
                    {x.body} · {ago(x.at / 1000)}
                  </small>
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => useInbox.getState().clear()}>
              {t("statusbar.inboxClear")}
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem disabled>{t("statusbar.inboxEmpty")}</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
