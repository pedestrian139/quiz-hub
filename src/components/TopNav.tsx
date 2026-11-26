import type { Route } from '../router/useHashRoute';
import { ROUTE_HASH } from '../router/useHashRoute';
import { Icon, type IconName } from './Icons';
import { useTheme } from './useTheme';
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
}

export function TopNav({ route, wrongCount, favCount, onNavClick }: TopNavProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  const badgeFor = (r: Route): number =>
    r === 'wrong' ? wrongCount : r === 'fav' ? favCount : 0;

  return (
    <header className="site-header">
      <div className="site-header__inner">
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

        <ApiSettingsButton />

        <button
          type="button"
          data-testid="theme-toggle"
          className="theme-toggle"
          aria-label={isDark ? '切换为浅色主题' : '切换为深色主题'}
          aria-pressed={isDark ? 'true' : 'false'}
          title={isDark ? '浅色主题' : '深色主题'}
          onClick={toggleTheme}
        >
          <span className="theme-toggle__icon theme-toggle__icon--sun" aria-hidden="true">
            <Icon name="sun" size={17} />
          </span>
          <span className="theme-toggle__icon theme-toggle__icon--moon" aria-hidden="true">
            <Icon name="moon" size={17} />
          </span>
        </button>
      </div>
    </header>
  );
}
