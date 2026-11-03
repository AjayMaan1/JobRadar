export const sent: any[] = []
export default { createTransport: (_o: any) => ({ sendMail: async (m: any) => { sent.push(m); return { messageId: 'sandbox' } } }) }
