import type { Route } from '../router/useHashRoute';
import { ROUTE_HASH } from '../router/useHashRoute';
import { Icon, type IconName } from './ui/Icons';
import { useTheme, type ThemePreference } from '../hooks/useTheme';
import { ApiSettingsButton } from './ApiSettings';

interface NavItem {
  route: Route;
  label: string;
  icon: IconName;
}

const NAV_ITEMS: NavItem[] = [
  { route: 'hub', label: '复习中心', icon: 'home' },
  { route: 'quiz', label: '刷题工具', icon: 'pen' },
  { route: 'wrong', label: '错题本', icon: 'bookX' },
  { route: 'fav', label: '收藏夹', icon: 'star' },
  { route: 'notes', label: '知识点手册', icon: 'book' },
];

interface TopNavProps {
  route: Route;
  wrongCount: number;
  favCount: number;
  onNavClick: (route: Route) => void;
  searchOpen: boolean;
  onOpenSearch: () => void;
}

const THEME_OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  icon: IconName;
}> = [
  { value: 'system', label: '跟随系统主题', icon: 'monitor' },
  { value: 'light', label: '浅色主题', icon: 'sun' },
  { value: 'dark', label: '深色主题', icon: 'moon' },
];

export function TopNav({ route, wrongCount, favCount, onNavClick, searchOpen, onOpenSearch }: TopNavProps) {
  const { theme, setTheme } = useTheme();
  const searchShortcut = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘K' : 'Ctrl+K';

  const badgeFor = (r: Route): number =>
    r === 'wrong' ? wrongCount : r === 'fav' ? favCount : 0;

  return (
    <header className="site-header">
      <div className="site-header__inner site-header__inner--search">
        <div className="brand">
          <span className="brand__logo" aria-hidden="true">
            QH
          </span>
          <span className="brand__text">
            <span className="brand__title">QuizHub</span>
            <span className="brand__sub">AI 智能刷题工作台</span>
          </span>
        </div>

        <nav className="site-nav" aria-label="主导航">
          {NAV_ITEMS.map((item) => {
            const active = item.route === route;
            const badge = badgeFor(item.route);
            return (
              <a
                key={item.route}
                href={ROUTE_HASH[item.route]}
                data-testid={`nav-${item.route}`}
                className={`site-nav__link${active ? ' is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => onNavClick(item.route)}
              >
                <span className="site-nav__icon" aria-hidden="true">
                  <Icon name={item.icon} size={16} />
                </span>
                <span className="site-nav__label">{item.label}</span>
                {badge > 0 && (
                  <span className="site-nav__badge" aria-hidden="true">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </a>
            );
          })}
        </nav>

        <div className="site-header__tools">
          <button
            type="button"
            data-testid="global-search-trigger"
            className="spotlight-trigger"
            aria-label="搜索题目"
            aria-keyshortcuts="Meta+K Control+K"
            aria-haspopup="dialog"
            aria-expanded={searchOpen}
            aria-controls={searchOpen ? 'spotlight-search' : undefined}
            onClick={onOpenSearch}
          >
            <Icon name="search" size={17} />
            <span className="spotlight-trigger__label">搜索题目…</span>
            <kbd aria-hidden="true">{searchShortcut}</kbd>
          </button>

          <ApiSettingsButton />

          <div
            className="theme-toggle theme-switcher"
            role="group"
            aria-label="主题模式切换"
            data-testid="theme-toggle"
          >
            {THEME_OPTIONS.map((opt) => {
              const active = theme === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  data-testid={`theme-option-${opt.value}`}
                  className={`theme-switcher__btn${active ? ' is-active' : ''}`}
                  aria-label={opt.label}
                  aria-pressed={active ? 'true' : 'false'}
                  title={opt.label}
                  onClick={() => setTheme(opt.value)}
                >
                  <Icon name={opt.icon} size={15} strokeWidth={1.75} />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </header>
  );
}
