import { createElement } from 'react'
/** next/link double: a plain anchor. */
export default function Link({ href, children, ...rest }: { href: string; children?: any; [k: string]: any }) {
  return createElement('a', { href, ...rest }, children)
}
