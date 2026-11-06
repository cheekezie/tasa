import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Cancel01Icon, Share05Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import IconWrapper from '@/shared/components/IconWrapper';

type ModalAction = {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  variant?: React.ComponentProps<typeof Button>['variant'];
  size?: React.ComponentProps<typeof Button>['size'];
  className?: string;
  closeOnClick?: boolean;
};

type ConfirmationModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  primaryAction: ModalAction;
  secondaryAction: ModalAction;
  primaryPosition?: 'first' | 'second';
  contentClassName?: string;
  bodyClassName?: string;
  footerClassName?: string;
};

const ActionButton = ({ action }: { action: ModalAction }) => {
  const button = (
    <Button
      type="button"
      onClick={action.onClick}
      disabled={action.disabled}
      variant={action.variant ?? 'default'}
      size={action.size ?? 'default'}
      className={cn('w-full sm:w-auto sm:min-w-[180px]', action.className)}
    >
      {action.label}
    </Button>
  );

  if (action.closeOnClick) {
    return <DialogClose asChild>{button}</DialogClose>;
  }

  return button;
};

export const ConfirmationModal = ({
  open,
  onOpenChange,
  title,
  icon = <HugeiconsIcon icon={Share05Icon} className="size-5" />,
  children,
  primaryAction,
  secondaryAction,
  primaryPosition = 'second',
  contentClassName,
  bodyClassName,
  footerClassName,
}: ConfirmationModalProps) => {
  const secondaryActionWithDefaults: ModalAction = {
    ...secondaryAction,
    variant: secondaryAction.variant ?? 'secondary',
  };

  const orderedActions =
    primaryPosition === 'first'
      ? [primaryAction, secondaryActionWithDefaults]
      : [secondaryActionWithDefaults, primaryAction];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'w-full max-w-[calc(100%-2rem)] overflow-hidden rounded-2xl p-0 sm:max-w-lg md:max-w-2xl lg:max-w-3xl',
          contentClassName
        )}
        showCloseButton={false}
      >
        <DialogHeader className="flex-row items-center gap-3 border-b border-grey-50 bg-grey-25 px-2 py-[10px]">
          {icon ? <IconWrapper>{icon}</IconWrapper> : null}
          <DialogTitle className="text-body text-grey-700 min-w-0 flex-1 truncate font-medium uppercase sm:text-base">
            {title}
          </DialogTitle>

          <IconWrapper className="ml-auto" onClick={() => onOpenChange(false)}>
            <HugeiconsIcon icon={Cancel01Icon} className="size-5" />
          </IconWrapper>
        </DialogHeader>

        <div className={cn('max-h-[min(70vh,700px)] overflow-y-auto p-2', bodyClassName)}>
          {children}
        </div>

        <div
          className={cn(
            'flex flex-col-reverse gap-3 border-t border-grey-50 px-6 py-4 sm:flex-row sm:justify-end',
            footerClassName
          )}
        >
          <ActionButton action={orderedActions[0]!} />
          <ActionButton action={orderedActions[1]!} />
        </div>
      </DialogContent>
    </Dialog>
  );
};
