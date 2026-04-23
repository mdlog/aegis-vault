import btcLogo from '../../assets/bitcoin-logo.png';
import ethLogo from '../../assets/eth-logo.jpeg';
import usdcLogo from '../../assets/usdcx-logo.png';
import zgLogo from '../../assets/0g-logo.png';

const logos = {
  BTC: btcLogo,
  WBTC: btcLogo,
  ETH: ethLogo,
  WETH: ethLogo,
  USDC: usdcLogo,
  WUSDC: usdcLogo,
  '0G': zgLogo,
  W0G: zgLogo,
  ZG: zgLogo,
};

const fallbackColors = {
  BTC: '#f7931a',
  WBTC: '#f7931a',
  ETH: '#627eea',
  WETH: '#627eea',
  USDC: '#2775ca',
  WUSDC: '#2775ca',
  '0G': '#4cc9f0',
  W0G: '#4cc9f0',
};

/**
 * Renders a token logo image, falling back to a colored dot.
 * @param {string} symbol - Token symbol (BTC, ETH, USDC, WBTC, WETH, etc.)
 * @param {number} size - Size in pixels (default 16)
 * @param {string} className - Additional classes
 */
export default function TokenIcon({ symbol, size = 16, className = '' }) {
  const src = logos[symbol?.toUpperCase()];

  if (src) {
    return (
      <img
        src={src}
        alt={symbol}
        width={size}
        height={size}
        className={`rounded-full object-cover flex-shrink-0 ${className}`}
      />
    );
  }

  const bg = fallbackColors[symbol?.toUpperCase()] || '#8a8a9a';
  const label = symbol ? symbol.toUpperCase().slice(0, 3) : '';
  const fontSize = Math.max(7, Math.round(size * (label.length >= 3 ? 0.32 : 0.42)));
  return (
    <div
      className={`rounded-full flex-shrink-0 flex items-center justify-center ${className}`}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${bg}, ${bg}dd)`,
        boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.08)`,
      }}
      title={symbol}
    >
      <span
        style={{
          color: '#0a0a0c',
          fontSize,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          fontFamily: 'system-ui, sans-serif',
          lineHeight: 1,
        }}
      >
        {label}
      </span>
    </div>
  );
}
