import logoImg from '../../assets/aegis-vault-logo.png';

export default function Logo({ size = 32, className = '' }) {
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
