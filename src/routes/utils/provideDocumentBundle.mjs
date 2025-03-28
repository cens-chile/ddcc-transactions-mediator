import { v4 as uuidv4 } from "uuid"
import fetch from "node-fetch"
import logger from "../../logger"
import { FHIR_SERVER, SUBMISSIONSET_IDENTIFIER_SYSTEM, FOLDER_IDENTIFIER_SYSTEM } from "../../config/config"
import { retrieveResource } from "./index"
import { createDDCC } from "./pdf"
import { convertBundleToCoreDataSet } from "./logicalModel"

const putPDBEntry = (resource) => {
  return {
    resource,
    request: {
      method: "PUT",
      url: resource.resourceType + "/" + resource.id
    }
  }
}
const postPDBEntry = (resourceType, tempId) => {
  return {
    fullUrl: "urn:uuid:" + tempId,
    resource: {
      resourceType: resourceType
    },
    request: {
      method: "POST",
      url: resourceType
    }
  }
}

const createPDBSubmissionSet = (options, submissionSetId, folderId, docRefId, binaryRefId, docId) => {
  let entry = postPDBEntry("List", submissionSetId)
  entry.resource.extension = [
    {
      url: "http://profiles.ihe.net/ITI/MHD/StructureDefinition/ihe-sourceId",
      valueIdentifier: {
        system: "origen",
        value: "Solucion Digital"
      }
    }
  ]
  entry.resource.identifier = [
    {
      use: "usual",
      system: SUBMISSIONSET_IDENTIFIER_SYSTEM,
      value: submissionSetId
    },
    {
      use: "official",
      system: SUBMISSIONSET_IDENTIFIER_SYSTEM,
      value: submissionSetId
    }
  ]
  entry.resource.subject = {
    reference: "Patient/" + options.resources.Patient.id
  }
  entry.resource.status = "current"
  entry.resource.mode = "working"
  entry.resource.code = {
    coding: [
      {
        system: "http://profiles.ihe.net/ITI/MHD/CodeSystem/MHDlistTypes",
        code: "submissionset"
      }
    ]
  }
  entry.resource.date = options.now
  entry.resource.entry = [
    {
      item: { reference: "urn:uuid:" + docRefId }
    },
    {
      item: { reference: "urn:uuid:" + binaryRefId }
    },
    {
      item: { reference: "List/" + folderId }
    }
  ]
  return entry
}

const createPDBBinaryReference = (options, binaryRefId, binaryId) => {
  let entry = postPDBEntry("DocumentReference", binaryRefId)
  entry.resource.status = "current"
  entry.resource.subject = {
    reference: "Patient/" + options.resources.Patient.id
  }
  entry.resource.date = options.now
  entry.resource.content = [
    {
      attachment: {
        contentType: "application/pdf",
        url: "urn:uuid:" + binaryId
      }
    }
  ]
  return entry
}

const createPDBPDF = (doc, options) => {
  return new Promise( async (resolve) => {
    let details = {
      hcid: options.responses.certificate.hcid.value,
      name: options.responses.name,
      id: options.responses.identifier.value,
      sex: options.responses.sex,
      birthDate: options.responses.birthDate
    }
    if ( options.resources.List ) {
      logger.info("Looking at old list", options.resources.List.id)
      let oldDocs = []
      let urlRegex = /(.*)(Bundle\/.+)/
      for( let entry of options.resources.List.entry ) {
        if ( entry.item && entry.item.reference && entry.item.reference.startsWith( "DocumentReference" ) ) {
          let docRef = await retrieveResource( entry.item.reference )
          if ( docRef.error ) continue
          try {
            if ( docRef.content[0].attachment.contentType === "application/fhir" ) {
              let matched = docRef.content[0].attachment.url.match( urlRegex )
              oldDocs.push( await retrieveResource( matched[2], matched[1] ) )

            }
          } catch( err ) {
            logger.info("Err on ",docRef.id)
            continue
          }
        }
      }
      
      for( let oldDoc of oldDocs ) {
        try {
          let oldResponses = await convertBundleToCoreDataSet( oldDoc )

          let dose = {
            date: oldResponses.vaccination.date,
            lot: oldResponses.vaccination.lot,
            vaccine: oldResponses.vaccination.vaccine 
              && oldResponses.vaccination.vaccine.display || oldResponses.vaccination.vaccine.code,
            brand: oldResponses.vaccination.brand 
              && oldResponses.vaccination.brand.display || oldResponses.vaccination.brand.code,
            manufacturer: (oldResponses.vaccination.manufacturer 
                && (oldResponses.vaccination.manufacturer.display 
                  || oldResponses.vaccination.manufacturer.code))
              || (oldResponses.vaccination.maholder 
                && (oldResponses.vaccination.maholder.display 
                  || oldResponses.vaccination.maholder.code)),
            hw: oldResponses.vaccination.practitioner && oldResponses.vaccination.practitioner.value,
            site: oldResponses.vaccination.centre,
            country: oldResponses.vaccination.country && oldResponses.vaccination.country.display || oldResponses.vaccination.country.code,
            doses: (typeof oldResponses.vaccination.totalDoses === 'number' ? oldResponses.vaccination.totalDoses.toString() : oldResponses.vaccination.totalDoses)
          }

          let docRefs = oldDoc.entry.filter( entry => entry.resource.resourceType === "DocumentReference" )
          let qrRef = docRefs.find( ref => ref.resource.type && ref.resource.type.coding && ref.resource.type.coding.find( coding => coding.code === "who" ) )
          if ( qrRef ) {
            let qr = qrRef.resource.content.find( content => content.attachment.contentType === "image/png" )
            dose.qr = qr.attachment.data
          }

          if (oldResponses.vaccination.dose === 1) {
            details.dose1 = dose
            if (oldResponses.vaccination.nextDose) {
              details.dose1.date_due = oldResponses.vaccination.nextDose
            }
          } else if (oldResponses.vaccination.dose === 2) {
            details.dose2 = dose
          }

        } catch( err ) {
          logger.info("Failed to process previous Document: " + oldDoc.id + " " + err.message)
          continue
        }
      }
    }
    let vacc = options.responses.vaccination
    let dose = {
      date: vacc.date,
      lot: vacc.lot,
      vaccine: vacc.vaccine && vacc.vaccine.display || vacc.vaccine.code,
      brand: vacc.brand && vacc.brand.display || vacc.brand.code,
      manufacturer: (vacc.manufacturer 
          && (vacc.manufacturer.display 
            || vacc.manufacturer.code))
        || (vacc.maholder 
          && (vacc.maholder.display
            || vacc.maholder.code)),
      hw: vacc.practitioner && vacc.practitioner.value,
      site: vacc.centre,
      country: vacc.country && vacc.country.display || vacc.country.code,
      doses: (typeof vacc.totalDoses === 'number' ? vacc.totalDoses.toString() : options.responses.vaccination.totalDoses)    }

    let docRefs = doc.entry.filter( entry => entry.resource.resourceType === "DocumentReference" )
    let qrRef = docRefs.find( ref => ref.resource.type && ref.resource.type.coding && ref.resource.type.coding.find( coding => coding.code === "who" ) )
    if ( qrRef ) {
      let qr = qrRef.resource.content.find( content => content.attachment.contentType === "image/png" )
      dose.qr = qr.attachment.data
    }


    if (vacc.dose === 1) {
      details.dose1 = dose
      if (vacc.nextDose) {
        details.dose1.date_due = vacc.nextDose
      }
    } else if (vacc.dose === 2) {
      details.dose2 = dose
    }
    createDDCC(details).then( pdf => {
       resolve(pdf)
     })
  })
}

const createPDBBinary = (options, binaryId) => {
  let entry = postPDBEntry("Binary", binaryId)

  entry.resource.contentType = "application/pdf"
  entry.resource.data = options.pdfs.DDCC
  return entry
}
const createPDBDocumentReference = (options, docRefId, docId) => {
  let entry = postPDBEntry("DocumentReference", docRefId)
  entry.resource.meta = {
    profile: ["http://worldhealthorganization.github.io/ddcc/StructureDefinition/DDCCDocumentReference"]
  }
  entry.resource.status = "current"
  let identifier = {
    "system": "http://worldhealthorganization.github.io/ddcc/DocumentReference",
    "value": docId
  }
  entry.resource.identifier = [identifier]
  entry.resource.masterIdentifier = identifier
  entry.resource.subject = {
    reference: "Patient/" + options.resources.Patient.id
  }
  entry.resource.date = options.now
  entry.resource.content = [
    {
      attachment: {
        contentType: "application/fhir+json",
        url: FHIR_SERVER + "Bundle/" + docId
      }
    }
  ]
  return entry
}

const createPDBFolder = (options, folderId, docRefId, binaryRefId) => {
  let entry
  if (options.resources.List) {
    entry = putPDBEntry(options.resources.List)
    entry.resource.date = options.now
  } else {
    let resource = {
      resourceType: "List",
      meta: {
        profile: ["http://worldhealthorganization.github.io/ddcc/StructureDefinition/DDCCDocumentReference"]
      },
      id: folderId,
      extension: [
        {
          url: "http://profiles.ihe.net/ITI/MHD/StructureDefinition/ihe-designationType",
          valueCodeableConcept: {
            coding: [
              {
                system: "http://worldhealthorganization.github.io/ddcc/CodeSystem/DDCC-Folder-DesignationType",
                code: "ddcc"
              }
            ]
          }
        }
      ],
      identifier: [
        {
          use: "usual",
          system: FOLDER_IDENTIFIER_SYSTEM,
          value: options.responses.certificate.hcid.value
        },
        {
          use: "official",
          system: FOLDER_IDENTIFIER_SYSTEM,
          value: options.responses.certificate.hcid.value
        }
      ],
      status: "current",
      mode: "working",
      code: {
        coding: [
          {
            system: "http://profiles.ihe.net/ITI/MHD/CodeSystem/MHDlistTypes",
            code: "folder"
          }
        ]
      },
      subject: { reference: "Patient/" + options.resources.Patient.id },
      date: options.now,
      entry: []
    }
    entry = putPDBEntry(resource)
  }
  entry.resource.entry.push({
    item: { reference: "urn:uuid:" + docRefId }
  })
  entry.resource.entry.push({
    item: { reference: "urn:uuid:" + binaryRefId }
  })
  return entry
}

const createAuditEvent = (options, submissionSetId) => {
  let entry = postPDBEntry("AuditEvent", uuidv4())
  entry.resource.meta = {
    profile: [
      "http://profiles.ihe.net/ITI/MHD/StructureDefinition/IHE.MHD.ProvideBundle.Audit.Recipient"
    ]
  }
  entry.resource.type = {
    system: "http://dicom.nema.org/resources/ontology/DCM",
    code: "110107",
    display: "Import"
  }
  entry.resource.subtype = [
    {
      system: "urn:ihe:event-type-code",
      code: "ITI-65",
      display: "Provide Document Bundle"
    }
  ]
  entry.resource.action = "C"
  entry.resource.recorded = options.now
  entry.resource.outcome = "0"
  entry.resource.agent = [
    {
      type: {
        coding: [
          {
            system: "http://dicom.nema.org/resources/ontology/DCM",
            code: "110153",
            display: "Source Role ID"
          }
        ]
      },
      who: {
        display: "Solucion Digital"
      },
      requestor: true,
      network: {
        address: "Servidor Solucion Digital",
        type: "1"
      }
    },
    {
      type: {
        coding: [
          {
            system: "http://dicom.nema.org/resources/ontology/DCM",
            code: "110152",
            display: "Destination Role ID"
          }
        ]
      },
      who: {
        display: "Servicio de generacion"
      },
      requestor: false,
      network: {
        address: "Servidor Servicio Generacion",
        type: "1"
      }
    }
  ]
  entry.resource.source = {
    observer: {
      display: "Servicio de generacion"
    },
    type: [
      {
        system: "http://terminology.hl7.org/CodeSystem/security-source-type",
        code: "4",
        display: "Application Server"
      }
    ]
  }
  entry.resource.entity = [
    {
      what: {
        reference: "Patient/" + options.resources.Patient.id
      },
      type: {
        system: "http://terminology.hl7.org/CodeSystem/audit-entity-type",
        code: "1",
        display: "Person"
      },
      role: {
        system: "http://terminology.hl7.org/CodeSystem/object-role",
        code: "1",
        display: "Patient"
      }
    },
    {
      what: {
        reference: "urn:uuid:" + submissionSetId
      },
      type: {
        system: "http://terminology.hl7.org/CodeSystem/audit-entity-type",
        code: "2",
        display: "System Object"
      },
      role: {
        system: "http://terminology.hl7.org/CodeSystem/object-role",
        code: "20",
        display: "Job"
      }
    }
  ]
  return entry
}

export const createProvideDocumentBundle = (doc, options) => {
  let docRefId = uuidv4()
  let binaryRefId = uuidv4()
  let binaryId = uuidv4()
  let submissionSetId = uuidv4()
  let folderId
  if ( options.resources.List ) {
    folderId = options.resources.List.id
  } else {
    folderId = uuidv4()
  }
  createPDBPDF(doc, options).then((pdf) => {
    options.pdfs.DDCC = Buffer.from(pdf).toString('base64')


    let PDBBinary = createPDBBinary(options, binaryId)
    let submissionSet = createPDBSubmissionSet(options, submissionSetId, folderId, docRefId, binaryRefId, doc.id)


    let provideDocumentBundle = {
      resourceType: "Bundle",
      type: "transaction",
      entry: [
        submissionSet,
        createPDBDocumentReference(options, docRefId, doc.id),
        PDBBinary,
        createPDBBinaryReference(options, binaryRefId, binaryId),
        createPDBFolder(options, folderId, docRefId, binaryRefId),
        putPDBEntry(options.resources.Patient),
        createAuditEvent(options, submissionSetId)
      ]
    }
    logger.info("provideDocumentBundle")
    //logger.info(JSON.stringify(provideDocumentBundle, null, 4))
    // Should change this to the a different config in case the registry is somewhere else.
    fetch(FHIR_SERVER, {
      method: "POST",
      body: JSON.stringify(provideDocumentBundle),
      headers: { "Content-Type": "application/fhir+json" }
    })
      .then((res) => res.json())
      .then((json) => {
        logger.info("Saved provideDocumentBundle and auditEvent.")
        
        //logger.info(JSON.stringify(json, null, 4))
      })
      .catch((err) => {
        logger.error(err.message)
      })

  })
}