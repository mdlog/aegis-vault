import logoImg from '../../assets/aegis-vault-logo.png';

export default function Logo({ size = 32, height, className = '' }) {
  if (height) {
    return (
      <img
        src={logoImg}
        alt="Aegis Vault"
        className={className}
        style={{ height, width: 'auto', objectFit: 'contain', display: 'block' }}
      />
    );
  }
  return (
    <img
      src={logoImg}
      alt="Aegis Vault"
      width={size}
      height={size}
      className={className}
      style={{ objectFit: 'contain' }}
    />
  );
}
