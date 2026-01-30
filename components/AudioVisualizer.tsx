import React, { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  analyser: AnalyserNode | null;
  isActive: boolean;
  color?: string;
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ analyser, isActive, color = '#38bdf8' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;

    // Size the canvas to match its CSS layout size, accounting for device pixel ratio
    let width = 0;
    let height = 0;
    function resizeCanvas() {
      const rect = canvas!.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas!.width = width * dpr;
      canvas!.height = height * dpr;
      ctx!.scale(dpr, dpr);
    }
    resizeCanvas();

    // Re-measure whenever the element changes size (e.g. window resize, orientation change)
    const resizeObserver = new ResizeObserver(() => resizeCanvas());
    resizeObserver.observe(canvas);

    const bufferLength = analyser ? analyser.frequencyBinCount : 0;
    const dataArray = analyser ? new Uint8Array(bufferLength) : new Uint8Array(0);

    const render = () => {
      if (!isActive || !analyser) {
        ctx.clearRect(0, 0, width, height);
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 2;
        ctx.stroke();
        return;
      }

      analyser.getByteFrequencyData(dataArray);
      ctx.clearRect(0, 0, width, height);

      const barWidth = (width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;
      const centerY = height / 2;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 2;
        ctx.fillStyle = color;
        ctx.fillRect(x, centerY - barHeight / 2, barWidth, barHeight);
        x += barWidth + 1;
      }

      animationRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      resizeObserver.disconnect();
    };
  }, [analyser, isActive, color]);

  return (
    <canvas 
      ref={canvasRef} 
      className="w-full h-full"
    />
  );
};

export default AudioVisualizer;