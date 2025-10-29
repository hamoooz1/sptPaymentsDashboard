export default function Logo({ className = "", size = 50 }) {
  return (
    <div 
      className={`flex items-center justify-center ${className}`}
    >
      <div 
        className="relative rounded-xl"
        style={{ 
          width: `${size}px`,
          height: `${size}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '4px'
        }}
      >
        <img 
          src="/sptLogo.png" 
          alt="SPT Logo" 
          className="object-contain" 
          style={{ 
            width: '100%',
            height: '100%',
            borderRadius: '8px',
            imageRendering: 'high-quality',
            objectFit: 'contain'
          }}
          onError={(e) => {
            console.error('Failed to load logo:', e.target.src);
          }}
        />
      </div>
    </div>
  );
}

