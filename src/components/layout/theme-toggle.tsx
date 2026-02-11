"use client";

import { MonitorCog, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "./theme-provider";

export default function ThemeToggle() {
  const { mode, setMode } = useTheme();

  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-1">
      <Button
        type="button"
        size="icon"
        variant={mode === "light" ? "default" : "ghost"}
        onClick={() => setMode("light")}
        aria-label="Light theme"
      >
        <Sun className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant={mode === "dark" ? "default" : "ghost"}
        onClick={() => setMode("dark")}
        aria-label="Dark theme"
      >
        <Moon className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant={mode === "system" ? "default" : "ghost"}
        onClick={() => setMode("system")}
        aria-label="System theme"
      >
        <MonitorCog className="h-4 w-4" />
      </Button>
    </div>
  );
}
