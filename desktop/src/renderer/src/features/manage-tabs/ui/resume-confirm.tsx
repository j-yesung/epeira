// 방금까지 움직이던 세션을 이어 열기 전에 묻는 창 (사이드바 지난 세션 · 궤도 패널 "탭으로 열기")
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";

import { focusActive } from "../model/actions";
import { openSession, useResumeConfirm } from "../model/sessions";

export function ResumeConfirm() {
  const { t } = useTranslation();
  const session = useResumeConfirm((s) => s.session);
  const close = () => useResumeConfirm.setState({ session: null });
  return (
    <Dialog open={!!session} onOpenChange={(o) => !o && close()}>
      <DialogContent
        showCloseButton={false}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          focusActive();
        }}
        className="sm:max-w-[440px]"
      >
        <DialogHeader>
          <DialogTitle>{t("session.recentTitle")}</DialogTitle>
          <DialogDescription>{t("session.recentBody")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={close}>
            {t("session.cancel")}
          </Button>
          <Button
            onClick={() => {
              if (session) openSession(session, true);
              close();
            }}
          >
            {t("session.openAnyway")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
