import type {ImgHTMLAttributes} from 'react';
type Props=ImgHTMLAttributes<HTMLImageElement>&{fill?:boolean;priority?:boolean;unoptimized?:boolean};
export default function Image({fill,priority,unoptimized:_,style,...props}:Props){void _;return <img {...props} loading={priority?'eager':props.loading??'lazy'} style={{...(fill?{position:'absolute',inset:0,width:'100%',height:'100%'}:{}),...style}}/>;}
