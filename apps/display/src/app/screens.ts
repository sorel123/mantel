import type { ComponentType } from 'react';
import { HomeScreen } from '../screens/home';
import { ListsScreen } from '../screens/lists';
import { MonthScreen } from '../screens/month';
import { TodayScreen } from '../screens/today';

export type ScreenId = 'today' | 'month' | 'lists' | 'home';

/** Dock order. Each screen folder is owned by one workstream (see README). */
export const screens: Array<{
  id: ScreenId;
  label: string;
  icon: string;
  Component: ComponentType;
}> = [
  {
    id: 'today',
    label: 'Today',
    icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    Component: TodayScreen,
  },
  {
    id: 'month',
    label: 'Month',
    icon: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    Component: MonthScreen,
  },
  {
    id: 'lists',
    label: 'Lists',
    icon: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>',
    Component: ListsScreen,
  },
  {
    id: 'home',
    label: 'Home',
    icon: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    Component: HomeScreen,
  },
];
