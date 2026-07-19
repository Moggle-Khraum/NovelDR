import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Theme, ThemeColors } from '@/constants/colors';

type ThemeContextType = {
  theme: Theme;
  colors: typeof ThemeColors.dark;
  setTheme: (t: Theme) => void;
};

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  colors: ThemeColors.dark,
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');

  useEffect(() => {
    AsyncStorage.getItem('app_theme').then((saved) => {
      if (
        saved === 'dark' ||
        saved === 'light' ||
        saved === 'sepia' ||
        saved === 'amoled' ||
        saved === 'warm' ||
        saved === 'slate'
      ) {
        setThemeState(saved as Theme);
      }
    });
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    AsyncStorage.setItem('app_theme', t);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, colors: ThemeColors[theme], setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
