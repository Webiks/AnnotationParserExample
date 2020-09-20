const fs = require('fs');
const yargs = require('yargs');
const TsSplitterCreator = require('./tsSplitter');
const TsFilterCreator = require('./tsFilter');
const TsParserCreator = require('./tsParser');
const AnnotationExtractorCreator = require('./annotationExtractor');

function process(filePath, isPrintPackets, isIncludeEmptyData) {
    let i = 0;
    const stream = fs.createReadStream(filePath);
    const packetSplitter = TsSplitterCreator();
    const packetFilter = TsFilterCreator(305);
    const packetParser = TsParserCreator();
    const annotationExtractor = AnnotationExtractorCreator(isIncludeEmptyData);
    stream.pipe(packetSplitter);
    packetSplitter.pipe(packetFilter);
    packetFilter.pipe(packetParser);
    packetParser.pipe(annotationExtractor);
    annotationExtractor.on('data', (data) => {
        i += 1;
        if (isPrintPackets) {
            console.debug('Annotation', data);
        }
    });
    annotationExtractor.on('unpipe', () => console.log('Total', i));
}

const argv = yargs.command("$0 <ts file> [print] [empty]").argv;
process(argv.tsfile, argv.p || argv.print, argv.e || argv.empty);