import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { useValue } from 'tldraw'
import { createDeviceLink, hostedAtom } from '../hosted/hosted'
import { pairInfoAtom, pairUrl, syncStatusAtom } from '../sync/pairing'

// PC: a QR code the tablet scans to open this canvas over Wi-Fi and draw on it with the pen.
export function TabletButton() {
	const [open, setOpen] = useState(false)
	const tablets = useValue('tablets', () => syncStatusAtom.get().tablets, [])
	return (
		<>
			<button onClick={() => setOpen((v) => !v)} className={`ms-status ${tablets ? 'on' : ''}`} title="Draw on this canvas from a tablet on the same Wi-Fi">
				{tablets > 0 && <span className="dot" />}
				{tablets ? `Tablet connected${tablets > 1 ? ` (${tablets})` : ''}` : 'Connect tablet'}
			</button>
			{open && (hostedAtom.get().hosted ? <HostedLinkPanel onClose={() => setOpen(false)} /> : <TabletPanel onClose={() => setOpen(false)} />)}
		</>
	)
}

// Hosted server: a one-time code that signs the tablet into this account (valid 5 minutes).
function HostedLinkPanel({ onClose }: { onClose: () => void }) {
	const tablets = useValue('tablets', () => syncStatusAtom.get().tablets, [])
	const [qr, setQr] = useState<string>()
	const [error, setError] = useState<string>()
	const make = () => {
		setQr(undefined)
		setError(undefined)
		createDeviceLink()
			.then(({ url }) => QRCode.toDataURL(url, { margin: 1, width: 240 }))
			.then(setQr, (err) => setError(String(err?.message ?? err)))
	}
	useEffect(make, [])

	return (
		<div className="ms-help ms-tablet">
			<button className="ms-help-close" onClick={onClose}>×</button>
			<h3>Open on your tablet</h3>
			<p>
				Scan this code with the Math Studio tablet app (or the tablet's camera). It signs the tablet into your account and opens
				this canvas; what you draw there shows up here live.
			</p>
			<div className="ms-tablet-qr">{qr ? <img src={qr} width={240} height={240} alt="Sign-in QR code" /> : error ?? 'Making code…'}</div>
			<p className={tablets ? 'ms-tablet-ok' : 'ms-tablet-wait'}>
				{tablets ? `${tablets} other device${tablets > 1 ? 's' : ''} connected.` : 'The code works once and expires in 5 minutes.'}{' '}
				<button onClick={make}>New code</button>
			</p>
			<p className="ms-tablet-note">Anyone who scans this code gets into your account, so don't share it.</p>
		</div>
	)
}

function TabletPanel({ onClose }: { onClose: () => void }) {
	const info = useValue('pairInfo', () => pairInfoAtom.get(), [])
	const tablets = useValue('tablets', () => syncStatusAtom.get().tablets, [])
	const [address, setAddress] = useState<string>()
	const ip = address && info?.addresses.includes(address) ? address : info?.addresses[0]
	const url = info && ip ? pairUrl(ip, info.token) : null
	const [qr, setQr] = useState<string>()

	useEffect(() => {
		setQr(undefined)
		if (url) QRCode.toDataURL(url, { margin: 1, width: 240 }).then(setQr, (err) => console.error('[qr]', err))
	}, [url])

	return (
		<div className="ms-help ms-tablet">
			<button className="ms-help-close" onClick={onClose}>×</button>
			<h3>Draw from your tablet</h3>
			{!info ? (
				<p>The local server is offline. Start it with <code>npm run dev</code>.</p>
			) : !ip ? (
				<p>No Wi-Fi or LAN address found. Connect this PC to the same Wi-Fi as the tablet.</p>
			) : (
				<>
					<p>
						With the tablet on the same Wi-Fi, scan this code with its camera. Math Studio opens in the tablet browser on this
						canvas, and everything you draw there shows up here live.
					</p>
					<div className="ms-tablet-qr">{qr ? <img src={qr} width={240} height={240} alt="Pairing QR code" /> : 'Making code…'}</div>
					<pre>{url}</pre>
					{info.addresses.length > 1 && (
						<p>
							Network address{' '}
							<select value={ip} onChange={(e) => setAddress(e.target.value)}>
								{info.addresses.map((a) => (
									<option key={a}>{a}</option>
								))}
							</select>{' '}
							(pick the Wi-Fi one if the tablet can't load the page)
						</p>
					)}
					<p className={tablets ? 'ms-tablet-ok' : 'ms-tablet-wait'}>
						{tablets ? `${tablets} tablet${tablets > 1 ? 's' : ''} connected.` : 'Waiting for a tablet…'}
					</p>
					<p className="ms-tablet-note">
						Page won't load on the tablet? Allow Node.js on <b>Private networks</b> in Windows Defender Firewall. On the tablet,
						use the browser's <i>Add to home screen</i> to open it like an app next time. Keep this code private: it lets a device
						on your network edit the canvas.
					</p>
				</>
			)}
		</div>
	)
}
