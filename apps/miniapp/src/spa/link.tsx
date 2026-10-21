import type { AnchorHTMLAttributes } from 'react';
import {navigate} from './navigation';
export default function Link({href,onClick,prefetch:_,...props}:AnchorHTMLAttributes<HTMLAnchorElement>&{prefetch?:boolean}) {
  void _;
  return <a {...props} href={href} onClick={event=>{onClick?.(event);if(href?.startsWith('/')&&!event.defaultPrevented&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey&&event.button===0&&!props.target){event.preventDefault();navigate(href);}}}/>;
}
