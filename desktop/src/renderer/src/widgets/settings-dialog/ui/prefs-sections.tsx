// 설정 › 알림 · 터미널 · 화면: 이 Mac 의 이 앱에만 저장 (app.prefs · 테마)
import { useEffect, useState } from "react";

import { useTranslation } from "react-i18next";

import { epeira } from "@/shared/api/epeira";
import { useDialogs } from "@/shared/lib/dialogs";
import { usePrefs } from "@/shared/lib/prefs";
import { useTheme } from "@/shared/lib/theme";
import { Button } from "@/shared/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";

import { Heading, Row, SegButton, Segmented, ToggleRow } from "./rows";

export function AlertsSection() {
  const { t } = useTranslation();
  const prefs = usePrefs();
  return (
    <>
      <Heading>{t("settings.sections.alerts")}</Heading>
      <ToggleRow
        title={t("settings.alerts.notify")}
        desc={t("settings.alerts.notifyDesc")}
        checked={prefs.notify}
        onChange={(v) => prefs.setPref("notify", v)}
      />
      {prefs.notify && (
        <>
          <ToggleRow
            title={t("settings.alerts.done")}
            checked={prefs.notifyDone}
            onChange={(v) => prefs.setPref("notifyDone", v)}
          />
          <ToggleRow
            title={t("settings.alerts.wait")}
            desc={t("settings.alerts.waitDesc")}
            checked={prefs.notifyWait}
            onChange={(v) => prefs.setPref("notifyWait", v)}
          />
          <ToggleRow
            title={t("settings.alerts.sound")}
            checked={prefs.sound}
            onChange={(v) => prefs.setPref("sound", v)}
          />
        </>
      )}
      <p className="text-faint-foreground text-sm">{t("settings.alerts.note")}</p>
    </>
  );
}

/** Radix Select 는 빈 값을 쓸 수 없어서 기본 글꼴은 이 값으로 */
const DEFAULT_FONT = "__default__";

export function TerminalSection() {
  const { t } = useTranslation();
  const prefs = usePrefs();
  const [fonts, setFonts] = useState<string[]>([]);
  useEffect(() => {
    epeira.fonts().then(setFonts);
  }, []);
  const list = [...new Set([...fonts, ...(prefs.fontTerm ? [prefs.fontTerm] : [])])];
  return (
    <>
      <Heading>{t("settings.sections.terminal")}</Heading>
      <Row title={t("settings.terminal.fontSize")}>
        <Segmented label={t("settings.terminal.fontSize")}>
          <SegButton
            aria-label={t("settings.terminal.smaller")}
            onClick={() => prefs.setPref("fontSize", Math.max(10, prefs.fontSize - 1))}
          >
            −
          </SegButton>
          <SegButton pressed disabled>
            {prefs.fontSize}px
          </SegButton>
          <SegButton
            aria-label={t("settings.terminal.bigger")}
            onClick={() => prefs.setPref("fontSize", Math.min(22, prefs.fontSize + 1))}
          >
            +
          </SegButton>
        </Segmented>
      </Row>
      <Row title={t("settings.terminal.font")} desc={t("settings.terminal.fontDesc")}>
        <Select
          value={prefs.fontTerm || DEFAULT_FONT}
          onValueChange={(v) => prefs.setPref("fontTerm", v === DEFAULT_FONT ? "" : v)}
        >
          <SelectTrigger size="sm" aria-label={t("settings.terminal.font")} className="w-[210px] shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT_FONT}>{t("settings.terminal.fontDefault")}</SelectItem>
            {list.map((f) => (
              <SelectItem key={f} value={f}>
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <ToggleRow
        title={t("settings.terminal.copyOnSelect")}
        desc={t("settings.terminal.copyOnSelectDesc")}
        checked={prefs.copyOnSelect}
        onChange={(v) => prefs.setPref("copyOnSelect", v)}
      />
      <ToggleRow
        title={t("settings.terminal.optionMeta")}
        desc={t("settings.terminal.optionMetaDesc")}
        checked={prefs.optionMeta}
        onChange={(v) => prefs.setPref("optionMeta", v)}
      />
    </>
  );
}

const THEMES = ["system", "light", "dark"] as const;

export function LookSection() {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <>
      <Heading>{t("settings.sections.look")}</Heading>
      <Row title={t("settings.look.theme")} desc={t("settings.look.themeDesc")}>
        <Segmented label={t("settings.look.theme")}>
          {THEMES.map((v) => (
            <SegButton key={v} pressed={theme.choice === v} onClick={() => theme.setChoice(v)}>
              {t(`settings.look.${v}`)}
            </SegButton>
          ))}
        </Segmented>
      </Row>
      <Row title={t("settings.look.shortcuts")} desc={t("settings.look.shortcutsDesc")}>
        <Button size="sm" variant="secondary" onClick={() => useDialogs.setState({ shortcuts: true, settings: null })}>
          {t("settings.look.show")}
        </Button>
      </Row>
    </>
  );
}
