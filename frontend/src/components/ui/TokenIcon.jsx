import btcLogo from '../../assets/bitcoin-logo.png';
import ethLogo from '../../assets/eth-logo.jpeg';
import usdcLogo from '../../assets/usdcx-logo.png';

const logos = {
  BTC: btcLogo,
  WBTC: btcLogo,
  ETH: ethLogo,
  WETH: ethLogo,
  USDC: usdcLogo,
  WUSDC: usdcLogo,
};

const fallbackColors = {
  BTC: '#f7931a',
  WBTC: '#f7931a',
  ETH: '#627eea',
  WETH: '#627eea',
  USDC: '#2775ca',
  WUSDC: '#2775ca',
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
  return (
    <div
      className={`rounded-full flex-shrink-0 ${className}`}
      style={{ width: size, height: size, backgroundColor: bg }}
    />
  );
}
