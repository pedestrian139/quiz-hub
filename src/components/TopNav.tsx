import type { Route } from '../router/useHashRoute';
import { ROUTE_HASH } from '../router/useHashRoute';

interface NavItem {
  route: Route;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { route: 'hub', label: '复习中心', icon: '🏠' },
  { route: 'quiz', label: '刷题工具', icon: '✍️' },
  { route: 'wrong', label: '错题本', icon: '📕' },
  { route: 'fav', label: '收藏夹', icon: '⭐' },
  { route: 'notes', label: '知识点手册', icon: '📘' },
];

interface TopNavProps {
  route: Route;
  wrongCount: number;
  favCount: number;
  onNavClick: (route: Route) => void;
}

export function TopNav({ route, wrongCount, favCount, onNavClick }: TopNavProps) {
  const badgeFor = (r: Route): number =>
    r === 'wrong' ? wrongCount : r === 'fav' ? favCount : 0;

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <div className="brand">
          <span className="brand__logo" aria-hidden="true">
            AI
          </span>
          <span className="brand__text">
            <span className="brand__title">人工智能导论</span>
            <span className="brand__sub">期末复习 · 自助刷题</span>
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
                  {item.icon}
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
      </div>
    </header>
  );
}
