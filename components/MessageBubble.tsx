import React from 'react';
import { Message } from '../types';
import VideoPlayer from './VideoPlayer';

interface MessageBubbleProps {
  message: Message;
  onPublishToFacebook?: (message: Message) => void;
  isPublishingDisabled?: boolean; 
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, onPublishToFacebook, isPublishingDisabled }) => {
  const isUser = message.role === 'user';
  const bubbleClasses = isUser
    ? 'bg-blue-500 text-white self-end rounded-br-none'
    : 'bg-gray-300 text-gray-800 self-start rounded-bl-none';

  const canPublish = onPublishToFacebook && message.role === 'bot' && !message.error && (message.content || message.imageUrl);

  const handlePublishClick = () => {
    if (onPublishToFacebook && canPublish && !isPublishingDisabled) {
      onPublishToFacebook(message);
    }
  };

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

            {canPublish && (
              <button
                onClick={handlePublishClick}
                disabled={isPublishingDisabled}
                className={`mt-3 flex items-center justify-center gap-2 px-3 py-1 text-sm font-medium rounded-full transition-colors duration-200
                  ${isPublishingDisabled ? 'bg-gray-400 text-gray-700 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}
                  shadow-md`}
                aria-label="Publish to Facebook Page"
                title="Publish this content directly to your configured Facebook Page"
              >
                <svg fill="currentColor" viewBox="0 0 24 24" width="1em" height="1em" className="inline-block">
                  <path d="M12 2.039c-5.52 0-10 4.48-10 10s4.48 10 10 10 10-4.48 10-10-4.48-10-10-10zm.775 14.538h-1.55v-4.111H9.864v-1.282h1.361v-.759c0-1.077.348-1.802 1.954-1.802h1.166v1.262h-.705c-.328 0-.46.12-.46.471v.828h1.282l-.184 1.282h-1.098v4.111z"></path>
                </svg>
                Publish to Facebook Page
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default MessageBubble;