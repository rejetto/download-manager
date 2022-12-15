exports.version = 0.1
exports.description = "Simple download manager. This version is very basic, close to an experiment."
exports.apiRequired = 4 // real_path
exports.repo = "rejetto/download-manager"

exports.config = {
    list: {
        type: 'array',
        minWidth: 500,
        height: 300,
        fields: {
            url: { label: "URL" },
            dest: { label: "Destination", type: 'real_path', files: false, folders: true, helperText: "Where to store the file" },
            state: { disabled: true },
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
        updateState(url, STARTED) // immediately change state, to be sure that it's not started twice
        const worker = workers[url] = { ...entry }
        const proto = url.startsWith('https://') ? https : http
        proto.get(url, res => {
            const dispo = res.headers['Content-Disposition']
            const match = dispo && /filename[^;=\n]*=(['"])(.*?)\2|[^;\n]*/.exec(dispo)
            const filename = pathLib.basename( match?.[2] || url )
            const path = pathLib.join(dest, filename)
            api.log('download started', url)
            const file = fs.createWriteStream(path).on("finish", () => {
                api.log('download finished', url)
                file.close()
                updateState(url, DONE)
            }).on('error', e => updateState(url, e))
            res.pipe(file)
            worker.response = res
        }).on('error', e => updateState(url, e))
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

    function killWorker({ url, response }) {
        console.debug('killWorker', url)
        delete workers[url]
        response?.destroy()
    }

    function moveDest(configEntry) {
        const worker = workers[configEntry.url]
        console.debug('moveDest', worker.dest, configEntry.dest)
        //TODO
    }

}