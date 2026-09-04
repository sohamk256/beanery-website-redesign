import { SLOTS } from '../assets/images';
import './ImageSlot.css';

function PlaceholderIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}

/**
 * Responsive image slot using native browser layout.
 *
 * The previous implementation measured every frame with ResizeObserver and
 * created a second Image object for every photograph. Safari can enter a
 * resize feedback loop when those calculated dimensions are used inside flex
 * rails. All current crops are centred, so object-fit gives the same visual
 * result without eager downloads, layout churn or observer loops.
 */
export default function ImageSlot({ id, placeholder, fit = 'cover', alt = '' }) {
  const slot = SLOTS[id];

  if (!slot) {
    return (
      <div className="imgslot" data-slot={id}>
        <div className="frame">
          <div className="empty">
            <PlaceholderIcon />
            <div className="cap">{placeholder || 'Image unavailable'}</div>
          </div>
          <div className="ring" />
        </div>
      </div>
    );
  }

  return (
    <div className="imgslot" data-slot={id} data-filled="">
      <div className="frame">
        <img
          src={slot.src}
          alt={alt}
          draggable="false"
          loading="lazy"
          decoding="async"
          style={{
            width: '100%',
            height: '100%',
            left: 0,
            top: 0,
            objectFit: fit === 'contain' ? 'contain' : 'cover',
            objectPosition: `${50 + slot.x}% ${50 + slot.y}%`,
            transform: slot.s === 1 ? 'none' : `scale(${slot.s})`,
          }}
        />
        <div className="ring" />
      </div>
    </div>
  );
}
