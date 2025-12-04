import React from 'react';
import { DailyPostTheme } from '../types';
import { DAILY_POST_THEMES } from '../constants';

interface ThemeSelectorProps {
  selectedTheme: DailyPostTheme;
  onThemeChange: (theme: DailyPostTheme) => void;
  isLoading: boolean;
}

const ThemeSelector: React.FC<ThemeSelectorProps> = ({ selectedTheme, onThemeChange, isLoading }) => {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="theme-select" className="text-gray-700 font-medium">Theme:</label>
      <select
        id="theme-select"
        value={selectedTheme}
        onChange={(e) => onThemeChange(e.target.value as DailyPostTheme)}
        disabled={isLoading}
        className="p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {DAILY_POST_THEMES.map((theme) => (
          <option key={theme.value} value={theme.value}>
            {theme.label}
          </option>
        ))}
      </select>
    </div>
  );
};

export default ThemeSelector;
