import React from 'react';
import { Message } from '../types';
import VideoPlayer from './VideoPlayer';

interface MessageBubbleProps {
  message: Message;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isUser = message.role === 'user';
  const bubbleClasses = isUser
    ? 'bg-blue-500 text-white self-end rounded-br-none'
    : 'bg-gray-300 text-gray-800 self-start rounded-bl-none';

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[70%] md:max-w-[60%] lg:max-w-[50%] p-3 my-2 rounded-xl shadow-md ${bubbleClasses}`}>
        {message.error ? (
          <p className="text-red-700 font-semibold">Error: {message.error}</p>
        ) : (
          <>
            <p className="whitespace-pre-wrap">{message.content}</p>
            {message.imageUrl && (
              <img src={message.imageUrl} alt="Generated content" className="mt-2 rounded-lg max-h-96 w-auto object-contain" />
            )}
            {message.videoUrl && (
              <div className="mt-2">
                <VideoPlayer src={message.videoUrl} />
              </div>
            )}
            {message.audioUrl && (
              <audio controls src={message.audioUrl} className="mt-2 w-full"></audio>
            )}
            {message.groundingUrls && message.groundingUrls.length > 0 && (
              <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
                <p className="font-semibold">Sources:</p>
                <ul className="list-disc list-inside">
                  {message.groundingUrls.map((url, index) => (
                    <li key={index}>
                      <a href={url.uri} target="_blank" rel="noopener noreferrer" className="text-blue-200 hover:underline">
                        {url.title || url.uri}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default MessageBubble;