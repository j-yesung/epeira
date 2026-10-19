// 단축키 안내 (⌘/)
import { useTranslation } from "react-i18next";

import { focusActive } from "@/features/manage-tabs/model/actions";
import { closeDialogs, useDialogs } from "@/shared/lib/dialogs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui/dialog";

const GROUPS = ["tabs", "panes", "view"] as const;

export function ShortcutsDialog() {
  const { t } = useTranslation();
  const open = useDialogs((s) => s.shortcuts);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeDialogs()}>
      <DialogContent
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          focusActive();
        }}
        className="max-h-[86vh] overflow-y-auto sm:max-w-[580px]"
      >
        <DialogHeader>
          <DialogTitle>{t("shortcuts.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("shortcuts.title")}</DialogDescription>
        </DialogHeader>
        {GROUPS.map((g) => (
          <section key={g} className="grid gap-2">
            <h3 className="font-bold text-faint-foreground text-xs tracking-widest">
              {t(`shortcuts.groups.${g}.title`)}
            </h3>
            <dl className="grid grid-cols-[150px_1fr] items-center gap-x-3.5 gap-y-[7px] text-foreground">
              {(t(`shortcuts.groups.${g}.keys`, { returnObjects: true }) as [string, string][]).map(([key, desc]) => (
                <div key={key} className="contents">
                  <dt>
                    <kbd>{key}</kbd>
                  </dt>
                  <dd>{desc}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}
