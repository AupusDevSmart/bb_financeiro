import React from 'react';
import { QRCodeSVG } from 'qrcode.react';

function QRCodePIX({ codigoPix, numeroTitulo }) {
  if (!codigoPix) {
    return null;
  }

  return (
    <div className="qrcode-container">
      <QRCodeSVG value={codigoPix} size={200} />
    </div>
  );
}

export default QRCodePIX;
