exports.version = 0.3
exports.description = "Simple download manager, extremely basic"
exports.apiRequired = 12.3 // config.getError
exports.repo = "rejetto/download-manager"
exports.changelog = [
    { "version": 0.3, "message": "download progress" },
    { "version": 0.2, "message": "handle destination changes while running" }
]

exports.config = {
    list: {
        type: 'array',
        label: '',
        fields: {
            url: { label: "URL", $width: 1.5, required: true, getError: v => { try { new URL(v) } catch { return "bad syntax" } } },
            dest: { label: "Destination", type: 'real_path', files: false, folders: true, required: true, helperText: "Where to store the file" },
            state: { disabled: true, $width: 130, showIf: values => values.url },
        }
    }
}

const STARTED = 'started'
const DONE = 'done'

exports.init = api => {
    const _ = api.require('lodash')
    const https = api.require('https');
    const http = api.require('http');
    const fs = api.require('fs')
    const pathLib = api.require('path')

    const workers = {}

    api.subscribeConfig('list', syncWithList)

    return {
        unload() {
            _.each(workers, killWorker)
        }
    }
    function syncWithList(list) {
        console.debug('sync', list)
        if (list) for (const entry of list) {
            const worker = workers[entry.url]
            if (!worker)
                startWorker(entry)
            else if (entry.dest !== worker.dest)
                moveDest(entry)
        }
        for (const url in workers)
            if (!_.find(list, {url}))
                killWorker(workers[url])
    }

    function startWorker(entry) {
        const { url, dest } = entry
        if (getState(url) === DONE) return
        try { new URL(url) }
        catch { return api.log("bad URL: " + url) }
        updateState(url, STARTED) // immediately change state, to be sure that it's not started twice
        const worker = workers[url] = { ...entry, stopping: false }
        const proto = url.startsWith('https://') ? https : http
        const req = proto.get(url, res => {
            if (worker.stopping)
                return res.destroy()
            if (res.statusCode < 200 || res.statusCode >= 300) {
                res.destroy()
                return updateState(url, Error(`HTTP ${res.statusCode}${res.statusMessage ? ' ' + res.statusMessage : ''}`))
            }
            const contentLength = res.headers['content-length']
            // Node can expose repeated headers as arrays; we still need one numeric length for progress.
            const totalBytes = Number(Array.isArray(contentLength) ? contentLength[0] : contentLength)
            let downloadedBytes = 0
            let lastProgress = -1
            if (totalBytes > 0)
                updateState(url, '0%')
            res.on('data', chunk => {
                if (!totalBytes || worker.stopping) return
                downloadedBytes += chunk.length
                const progress = Math.floor(downloadedBytes / totalBytes * 100)
                if (progress === lastProgress) return
                // Avoid writing config on every chunk: only persist when visible progress changes.
                lastProgress = progress
                updateState(url, `${Math.min(100, progress)}%`)
            })
            const dispo = res.headers['content-disposition']
            const match = dispo && /filename[^;=\n]*=(['"])(.*?)\2|[^;\n]*/.exec(dispo)
            const filename = pathLib.basename( match?.[2] || url )
            const path = pathLib.join(dest, filename)
            api.log('download started', url)
            worker.path = path
            const file = fs.createWriteStream(path).on("finish", () => {
                if (worker.stopping) return
                api.log('download finished', url)
                file.close()
                updateState(url, DONE)
            }).on('error', e => worker.stopping || updateState(url, e))
            worker.file = file
            res.on('error', e => worker.stopping || updateState(url, e))
            res.pipe(file)
            worker.response = res
        }).on('error', e => worker.stopping || updateState(url, e))
        worker.request = req
    }

    function killWorker(worker, { removePartial }={}) {
        if (!worker) return
        const { url, request, response, file, path } = worker
        worker.stopping = true
        delete workers[url]
        request?.destroy()
        response?.destroy()
        file?.destroy()
        if (removePartial && path)
            fs.rm(path, { force: true }, _.noop)
    }

    function moveDest(configEntry) {
        const worker = workers[configEntry.url]
        if (!worker) return
        if (worker.state === DONE) return
        api.log('moveDest', worker.dest, configEntry.dest)
        killWorker(worker, { removePartial: true })
        startWorker(configEntry)
    }

    function getState(url) {
        return _.find(api.getConfig('list'), {url})?.state
    }

    function updateState(url, state) {
        if (state && state instanceof Error) {
            state = String(state)
            api.log('error', state, url)
        }
        else
            console.debug("updateState", state, url)
        const list = api.getConfig('list')
        api.setConfig('list', list.map(x => x.url === url ?  { ...x, state } : x) )
        const worker = workers[url]
        if (worker)
            worker.state = state
    }

}
