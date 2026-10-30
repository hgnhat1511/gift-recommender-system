import { useEffect, useState, useRef } from 'react';
import { ArrowUp, MessageCircle, X } from 'lucide-react';
import { siteInfo } from '../config/siteInfo.js';
import './FloatingSocialDock.css';

function ZaloIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M24 4C12.95 4 4 12.06 4 22c0 5.68 2.97 10.76 7.64 14.23-.33 2.21-1.43 5.48-3.3 7.57 0 0 4.88-.65 8.84-3.46 2.16.63 4.47.96 6.82.96 11.05 0 20-8.06 20-18S35.05 4 24 4z" fill="#0068FF"/>
      <text x="24" y="27" textAnchor="middle" fill="#FFFFFF" fontSize="13" fontWeight="900" fontFamily="system-ui, -apple-system, sans-serif" letterSpacing="-0.5px">Zalo</text>
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5"/>
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/>
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 0 0-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .37z"/>
    </svg>
  );
}

function TwitterXIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
  );
}

const rawSocialChannels = [
  {
    id: 'zalo',
    name: 'Zalo',
    label: 'Chat Zalo tư vấn',
    className: 'floating-social-zalo',
    Icon: ZaloIcon,
    hasPulse: true,
  },
  {
    id: 'facebook',
    name: 'Facebook',
    label: 'Nhắn tin Messenger',
    className: 'floating-social-fb',
    Icon: FacebookIcon,
  },
  {
    id: 'instagram',
    name: 'Instagram',
    label: 'Theo dõi Instagram',
    className: 'floating-social-ig',
    Icon: InstagramIcon,
  },
  {
    id: 'telegram',
    name: 'Telegram',
    label: 'Hỗ trợ Telegram',
    className: 'floating-social-tele',
    Icon: TelegramIcon,
  },
  {
    id: 'x',
    name: 'X (Twitter)',
    label: 'Theo dõi X',
    className: 'floating-social-x',
    Icon: TwitterXIcon,
  },
];

export function FloatingSocialDock() {
  const [isOpen, setIsOpen] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const dockRef = useRef(null);

  // Chỉ hiển thị các kênh mạng xã hội có URL chính thức được cung cấp
  const activeSocialLinks = rawSocialChannels
    .map((item) => ({
      ...item,
      href: siteInfo.socialLinks?.[item.id] || '',
    }))
    .filter((item) => Boolean(item.href && item.href.trim()));

  useEffect(() => {
    const handleScroll = () => {
      // Khi lướt xuống gần giữa trang (qua 350px) thì hiện nút mũi tên lên đầu trang
      setShowScrollTop(window.scrollY > 350);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Hỗ trợ phím Escape để đóng dock khi đang mở
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  };

  return (
    <aside
      className="floating-dock-container"
      aria-label="Tiện ích liên hệ và cuộn trang"
      ref={dockRef}
    >
      {/* Nút cuộn về đầu trang (hiển thị khi cuộn xuống gần giữa trang) */}
      <button
        type="button"
        className={`scroll-to-top-btn ${showScrollTop ? 'is-visible' : ''}`}
        onClick={scrollToTop}
        aria-label="Cuộn về đầu trang"
        title="Cuộn về đầu trang"
      >
        <ArrowUp size={20} strokeWidth={2.4} aria-hidden="true" />
        <span className="floating-dock-tooltip" role="tooltip">
          Cuộn về đầu trang
        </span>
      </button>

      {/* Danh sách các icon mạng xã hội có URL chính thức (chỉ hiển thị nếu có ít nhất 1 kênh cấu hình) */}
      {activeSocialLinks.length > 0 && (
        <>
          <div
            className={`floating-social-list ${isOpen ? 'is-expanded' : 'is-collapsed'}`}
            aria-hidden={!isOpen}
          >
            {activeSocialLinks.map(({ id, label, href, className, Icon, hasPulse }) => (
              <a
                key={id}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={`floating-social-btn ${className} ${hasPulse ? 'is-pulsing' : ''}`}
                aria-label={label}
                title={label}
                tabIndex={isOpen ? 0 : -1}
              >
                <span className="floating-social-icon">
                  <Icon />
                </span>
                <span className="floating-dock-tooltip" role="tooltip">
                  {label}
                </span>
              </a>
            ))}
          </div>

          {/* Nút gom các icon vào 1 chỗ hoặc phóng ra (đã xóa badge 5, có aria-expanded) */}
          <button
            type="button"
            className={`floating-toggle-btn ${isOpen ? 'is-open' : 'is-closed'}`}
            onClick={() => setIsOpen((prev) => !prev)}
            aria-label={isOpen ? 'Thu gọn các kênh liên hệ' : 'Mở các kênh liên hệ và tư vấn'}
            aria-expanded={isOpen}
          >
            {isOpen ? (
              <X size={22} strokeWidth={2.4} aria-hidden="true" />
            ) : (
              <MessageCircle size={23} strokeWidth={2.2} aria-hidden="true" />
            )}
            <span className="floating-dock-tooltip" role="tooltip">
              {isOpen ? 'Thu gọn' : 'Kênh liên hệ & tư vấn'}
            </span>
          </button>
        </>
      )}
    </aside>
  );
}

export default FloatingSocialDock;
