'use strict'

import {buildReturnObject,buildErrorObject,retrieveDocumentReference} from './utils'
import logger from '../logger'

module.exports = async (_req, res) => {
    let shcid = _req.params.shcid
    logger.info('Retrieve QR Code endpoint triggered ID=' + shcid)

    let Document = await retrieveDocumentReference(shcid)
    let returnObject

    if ( Document.resourceType !== "DocumentReference" ) {
	logger.info("Did not recieve expected DocumentReference ID=" + shcid )
	logger.info("Recevied: " + JSON.stringify(Document))
	returnObject = buildErrorObject("Could not retrieve DocumentReference")
    } else {
	logger.info("Processing DocumentReference ID=" + shcid)
	let attachment = Document.content[0].attachment
	//attachment really should be obtained via a fhirpath query against a category/type/code (e.g. whp, icao, dgc...)
	
	returnObject = buildReturnObject(
	    'Successful',
	    '200',
	    attachment.data
	)
	returnObject.response.headers['content-type'] = attachment.contentType
    }
    
    return res.send(returnObject)

}