"use client";

import type { JSX } from "react";
import { useSyncExternalStore } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { motion } from "motion/react";
import { useTheme } from "next-themes";

function ThemeOption({
  icon,
  value,
  isActive,
  onClick,
}: {
  icon: JSX.Element;
  value: string;
  isActive?: boolean;
  onClick: (value: string) => void;
}) {
  return (
    <button
      data-active={isActive}
      className="relative flex size-8 items-center justify-center rounded-full text-muted-foreground transition-[color] hover:text-foreground data-[active=true]:text-foreground [&_svg]:size-4"
      role="radio"
      aria-checked={isActive}
      aria-label={`Switch to ${value} theme`}
      onClick={() => onClick(value)}
    >
      {icon}
    </button>
  );
}

const THEME_OPTIONS = [
  {
    icon: <MonitorIcon />,
    value: "system",
  },
  {
    icon: <SunIcon />,
    value: "light",
  },
  {
    icon: <MoonIcon />,
    value: "dark",
  },
];

function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  const isMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  if (!isMounted) {
    return <div className="flex h-8 w-24" />;
  }

  // Deterministic sliding indicator: one pill gliding via transform
  // (translateX per option index) so the motion never depends on
  // shared-layout magic. 3 options x 32px.
  const activeIndex = Math.max(
    0,
    THEME_OPTIONS.findIndex((o) => o.value === theme)
  );

  return (
    <motion.div
      key={String(isMounted)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="relative inline-flex items-center overflow-clip rounded-full bg-background"
      role="radiogroup"
    >
      <span
        aria-hidden
        className="absolute left-0 top-0 size-8 rounded-full bg-ink/[0.08] transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
        style={{ transform: `translateX(${activeIndex * 32}px)` }}
      />
      {THEME_OPTIONS.map((option) => (
        <ThemeOption
          key={option.value}
          icon={option.icon}
          value={option.value}
          isActive={theme === option.value}
          onClick={setTheme}
        />
      ))}
    </motion.div>
  );
}

export { ThemeSwitcher };
