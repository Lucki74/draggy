import { Icon } from "./icons/Icon";

interface ImagePreviewProps {
    src: string;
    alt: string;
    onDelete?: () => void;
    size?: "sm" | "md" | "lg";
}

export function ImagePreview({ src, alt, onDelete, size = "md" }: ImagePreviewProps) {
    const sizeClasses = {
        sm: "w-16 h-16 max-w-[64px] max-h-[64px]",
        md: "w-[100px] h-[100px] max-w-[100px] max-h-[100px]",
        lg: "w-[100px] h-[100px] max-w-[100px] max-h-[100px]",
    }[size];

    return (
        <div className="relative inline-block group shrink-0">
            <img
                src={src}
                alt={alt}
                className={`rounded-lg object-cover border border-rule ${sizeClasses}`}
            />
            {onDelete && (
                <button
                    type="button"
                    onClick={onDelete}
                    className="absolute -top-1.5 -end-1.5 p-0.5 rounded-full bg-surface-base border border-rule hover:bg-danger/10 hover:border-danger transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                    aria-label="Remove attachment"
                >
                    <Icon name="x" size={10} />
                </button>
            )}
        </div>
    );
}
