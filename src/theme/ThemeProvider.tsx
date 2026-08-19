import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { palettes, type Palette, type ThemeName } from './tokens';
import { useVybe } from '@/store/useVybe';

type ThemeValue = {
  name: ThemeName;
  c: Palette;
  isDark: boolean;
};

const ThemeContext = createContext<ThemeValue>({
  name: 'dark',
  c: palettes.dark,
  isDark: true,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const preference = useVybe((s) => s.themePreference);

  const value = useMemo<ThemeValue>(() => {
    const name: ThemeName =
      preference === 'system' ? (system === 'light' ? 'light' : 'dark') : preference;
    return { name, c: palettes[name], isDark: name === 'dark' };
  }, [preference, system]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Semantic colours for the active theme. */
export function useTheme() {
  return useContext(ThemeContext);
}
