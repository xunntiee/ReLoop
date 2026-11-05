import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  applyTheme,
  persistTheme,
  resolvePreferredTheme,
  type AppTheme,
} from "@/lib/theme";

export const ThemeToggle = () => {
  const [theme, setTheme] = useState<AppTheme>(() => resolvePreferredTheme());

  useEffect(() => {
    applyTheme(theme);
    persistTheme(theme);
  }, [theme]);

  const nextTheme: AppTheme = theme === "dark" ? "light" : "dark";

  return (
    <Button
      aria-label={theme === "dark" ? "Chuyển sang chế độ sáng" : "Chuyển sang chế độ tối"}
      className="shadow-sm"
      onClick={() => setTheme(nextTheme)}
      size="icon-sm"
      title={theme === "dark" ? "Chế độ sáng" : "Chế độ tối"}
      type="button"
      variant="outline"
    >
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
};
