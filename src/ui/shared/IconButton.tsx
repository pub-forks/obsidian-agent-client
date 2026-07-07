import * as React from "react";
const { useRef, useEffect, useImperativeHandle, forwardRef } = React;
import { setIcon } from "obsidian";

/**
 * Renders an Obsidian Lucide icon via setIcon().
 * Used as a replacement for emoji icons to match Obsidian's native UI.
 */
export function LucideIcon({
	name,
	className,
}: {
	name: string;
	className?: string;
}) {
	const ref = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		if (ref.current) {
			setIcon(ref.current, name);
		}
	}, [name]);

	return <span ref={ref} className={className} />;
}

/**
 * Icon button component using Obsidian's setIcon.
 */
export function IconButton({
	iconName,
	label,
	className,
	onClick,
}: {
	iconName: string;
	label: string;
	className: string;
	onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
}) {
	const iconRef = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		if (iconRef.current) {
			setIcon(iconRef.current, iconName);
		}
	}, [iconName]);

	return (
		<div
			ref={iconRef}
			className={className}
			aria-label={label}
			onClick={onClick}
		/>
	);
}

interface HeaderButtonProps {
	iconName: string;
	tooltip: string;
	onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

export const HeaderButton = forwardRef<HTMLButtonElement, HeaderButtonProps>(
	function HeaderButton({ iconName, tooltip, onClick }, ref) {
		const buttonRef = useRef<HTMLButtonElement>(null);

		// Expose the button ref to parent components
		useImperativeHandle(ref, () => buttonRef.current!, []);

		useEffect(() => {
			if (buttonRef.current) {
				setIcon(buttonRef.current, iconName);
			}
		}, [iconName]);

		return (
			<button
				ref={buttonRef}
				title={tooltip}
				onClick={onClick}
				className="clickable-icon agent-client-header-button"
			/>
		);
	},
);
