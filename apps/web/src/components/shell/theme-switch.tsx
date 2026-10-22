import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useTheme, type ThemeChoice } from "@/hooks/use-theme";

export function ThemeSwitch() {
  const { choice, setChoice } = useTheme();
  return (
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      value={choice}
      onValueChange={(v) => v && setChoice(v as ThemeChoice)}
      aria-label="Colour theme"
    >
      <ToggleGroupItem value="light" aria-label="Light theme">
        <SunIcon />
      </ToggleGroupItem>
      <ToggleGroupItem value="system" aria-label="Match system theme">
        <MonitorIcon />
      </ToggleGroupItem>
      <ToggleGroupItem value="dark" aria-label="Dark theme">
        <MoonIcon />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
