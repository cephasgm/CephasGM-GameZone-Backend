/**
 * ============================================================
 * CephasGM GameZone — KYC Service
 * ============================================================
 * Flow:
 *   1. User submits document URLs (uploaded to Cloudinary
 *      from the frontend OR via our /upload endpoint)
 *   2. Documents stored with status PENDING
 *   3. User status → PENDING
 *   4. Admin reviews → APPROVED / REJECTED
 *   5. On approval: user.kycStatus = APPROVED, kycVerifiedAt set
 *
 * Note: for simplicity we accept document URLs directly. In
 * production, users upload to Cloudinary via a signed URL we
 * generate. That signed-URL flow is added in a follow-up.
 * ============================================================
 */

'use strict';

const prisma = require('../config/database');
const { AppError } = require('../utils/AppError');
const logger = require('../config/logger');

/* ------------------------------------------------------------
   SUBMIT
   ------------------------------------------------------------ */
async function submit(userId, { documents }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');

  if (user.kycStatus === 'APPROVED') {
    throw new AppError('KYC already approved', 400, 'KYC_ALREADY_APPROVED');
  }
  if (user.kycStatus === 'PENDING') {
    throw new AppError('KYC already under review', 400, 'KYC_PENDING');
  }

  /* Create the documents + flip user status — inside one transaction */
  const result = await prisma.$transaction(async (tx) => {
    /* Delete any previous rejected docs */
    await tx.kYCDocument.deleteMany({ where: { userId } });

    const created = await Promise.all(
      documents.map((d) =>
        tx.kYCDocument.create({
          data: {
            userId,
            documentType: d.documentType,
            documentUrl: d.documentUrl,
            documentNumber: d.documentNumber || null,
            cloudinaryId: d.cloudinaryId || null,
            status: 'PENDING',
          },
        })
      )
    );

    await tx.user.update({
      where: { id: userId },
      data: { kycStatus: 'PENDING' },
    });

    return created;
  });

  logger.info({ userId, count: result.length }, '📄 KYC submitted');

  return result.map(publicDoc);
}

/* ------------------------------------------------------------
   GET MY DOCUMENTS / STATUS
   ------------------------------------------------------------ */
async function getMyStatus(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { kycStatus: true, kycVerifiedAt: true, kycRejectionNote: true },
  });
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');

  const documents = await prisma.kYCDocument.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });

  return {
    status: user.kycStatus,
    verifiedAt: user.kycVerifiedAt,
    rejectionNote: user.kycRejectionNote,
    documents: documents.map(publicDoc),
  };
}

/* ------------------------------------------------------------
   ADMIN REVIEW
   ------------------------------------------------------------ */
async function review(adminId, userId, { status, rejectionNote = null }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  if (user.kycStatus !== 'PENDING') {
    throw new AppError(`User KYC is not pending (current: ${user.kycStatus})`, 400, 'INVALID_STATE');
  }

  await prisma.$transaction(async (tx) => {
    await tx.kYCDocument.updateMany({
      where: { userId, status: 'PENDING' },
      data: {
        status,
        reviewedBy: adminId,
        reviewedAt: new Date(),
        rejectionNote,
      },
    });

    await tx.user.update({
      where: { id: userId },
      data: {
        kycStatus: status,
        kycVerifiedAt: status === 'APPROVED' ? new Date() : null,
        kycRejectionNote: status === 'REJECTED' ? rejectionNote : null,
      },
    });

    /* Audit log */
    await tx.auditLog.create({
      data: {
        actorId: adminId,
        action: status === 'APPROVED' ? 'KYC_APPROVED' : 'KYC_REJECTED',
        targetType: 'User',
        targetId: userId,
        metadata: rejectionNote ? { rejectionNote } : undefined,
      },
    });
  });

  logger.info({ adminId, userId, status }, `✅ KYC ${status.toLowerCase()}`);

  return { reviewed: true, status };
}

/* ------------------------------------------------------------
   PUBLIC SHAPE
   ------------------------------------------------------------ */
function publicDoc(doc) {
  return {
    id: doc.id,
    documentType: doc.documentType,
    documentUrl: doc.documentUrl,
    status: doc.status,
    rejectionNote: doc.rejectionNote,
    reviewedAt: doc.reviewedAt,
    createdAt: doc.createdAt,
  };
}

module.exports = {
  submit,
  getMyStatus,
  review,
};