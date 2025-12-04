import React from 'react';

interface VideoPlayerProps {
  src: string;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ src }) => {
  return (
    <div className="w-full bg-black rounded-lg overflow-hidden shadow-lg">
      <video controls src={src} className="w-full h-auto max-h-96 object-contain" />
    </div>
  );
};

export default VideoPlayer;
